import { describe, expect, test } from 'bun:test';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import type { ThreadQuestionEntry, ThreadToolEntry, ThreadToolState } from '../../transcript/entries';
import { EFFECT_STOPPED_BEFORE_SETTLING, unsettledCallEvents } from './ThreadEffectSettlement';

const RUN = 'run-1';

function call(toolCallId: string, toolState: ThreadToolState, rest: Partial<ThreadToolEntry> = {}): ThreadToolEntry {
  return {
    type: 'tool',
    id: `tool:${toolCallId}`,
    runId: RUN,
    toolName: 'spawn_agent',
    toolCallId,
    toolState,
    ...rest,
  };
}

const announced = [Message.assistant([ToolCallPart.from({ id: 'dispatched', name: 'spawn_agent', input: { agentId: 'tagma' } })])];

function settlement(events: readonly { kind: string; payload: unknown }[]): readonly ThreadToolEntry[] {
  return events.map((event) => (event.payload as { entry: ThreadToolEntry }).entry);
}

describe('unsettledCallEvents', () => {
  test('a call whose input was still arriving is closed by the run that ended', () => {
    const streaming = call('streaming', 'input-streaming', {
      toolInput: { agentId: 'tagma', name: 'build-store' },
      toolDisplay: { form: 'none', title: 'build-store' },
    });

    const events = unsettledCallEvents(RUN, [streaming], announced);

    expect(settlement(events)).toMatchObject([
      {
        toolCallId: 'streaming',
        toolState: 'input-interrupted',
        toolInput: { agentId: 'tagma', name: 'build-store' },
        toolDisplay: { form: 'none', title: 'build-store' },
      },
    ]);
    expect(events[0]?.payload).not.toHaveProperty('messages');
  });

  test('a dispatched call the request carried is answered for the model as well as the reader', () => {
    const events = unsettledCallEvents(RUN, [call('dispatched', 'input-available')], announced);

    expect(settlement(events)).toMatchObject([{ toolCallId: 'dispatched', toolState: 'output-unknown' }]);
    expect((events[0]?.payload as { messages?: readonly Message[] }).messages).toHaveLength(1);
  });

  test('a started call whose tool changes nothing ends cancelled, while one that changes something stays unknown', () => {
    const at = '2026-10-15T00:00:00.000Z';
    const record = [
      call('reading', 'input-available', { execution: { state: 'started', at, mutates: false } }),
      call('dispatched', 'input-available', { execution: { state: 'started', at, mutates: true } }),
    ];

    expect(settlement(unsettledCallEvents(RUN, record, announced))).toMatchObject([
      { toolCallId: 'reading', toolState: 'output-cancelled' },
      { toolCallId: 'dispatched', toolState: 'output-unknown' },
    ]);
  });

  test('a call that answered is left alone, whichever entry of the record says so', () => {
    const record = [call('answered', 'input-available'), call('answered', 'output-available', { toolOutput: 'done' })];

    expect(unsettledCallEvents(RUN, record, announced)).toEqual([]);
  });

  test('a call of another run is not this run ending', () => {
    const other = { ...call('elsewhere', 'input-streaming'), runId: 'run-2' };

    expect(unsettledCallEvents(RUN, [other], announced)).toEqual([]);
  });

  test('a call the thread is still asking about is left to the question that parked it', () => {
    const parked: ThreadQuestionEntry = {
      type: 'question',
      id: 'interaction:q',
      runId: RUN,
      questionId: 'dispatched',
      questions: [],
      toolCalls: [{ toolCallId: 'dispatched', toolName: 'spawn_agent' }],
      status: 'open',
    };

    expect(unsettledCallEvents(RUN, [call('dispatched', 'input-available')], announced, parked)).toEqual([]);
  });

  test('a parked question does not silence the other calls the run left open', () => {
    const parked: ThreadQuestionEntry = {
      type: 'question',
      id: 'interaction:q',
      runId: RUN,
      questionId: 'asked',
      questions: [],
      toolCalls: [{ toolCallId: 'asked', toolName: 'ask_user' }],
      status: 'open',
    };
    const record = [call('asked', 'input-available'), call('dispatched', 'input-available')];

    expect(settlement(unsettledCallEvents(RUN, record, announced, parked))).toMatchObject([
      { toolCallId: 'dispatched', toolState: 'output-unknown' },
    ]);
  });
});
