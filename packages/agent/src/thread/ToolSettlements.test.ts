import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Exit, Layer, Schema } from 'effect';
import { ToolSettlements } from '../agent/ToolSettlements';
import { callerInThread } from '../agent/testing/caller';
import { ThreadEntryKinds, makeThreadEntryReader } from '../transcript/kinds';
import type { ThreadToolEntry } from '../transcript/entries';
import { threadEntryEvent } from './events';
import { ThreadEventJournal } from './ThreadPorts';
import { makeAggregateStorage } from './storage/InMemoryAggregateStorage';
import { threadToolSettlementsLayer } from './ToolSettlements';
import { settleInterruptedEffects } from './run/ThreadEffectSettlement';
import { Tool } from '../agent/tool';
import { ASKS_NEVER } from '../permissions/vocabulary';
import { Message, ToolCallPart } from '@runlith/llm/schema/messages';
import { writerOrderedLane } from './transition/lane';
const ports = Layer.mergeAll(
  ThreadEntryKinds.layer([]),
  Layer.succeed(
    ThreadEventJournal,
    ThreadEventJournal.of({
      append: (event) => Effect.succeed({ ...event, position: 1 }),
      recordsAsOf: () => Effect.succeed([]),
      revisionsAsOf: () => Effect.succeed([]),
      eventsAfter: () => Effect.succeed([]),
      headPosition: () => Effect.succeed(0),
      positionOf: () => Effect.succeed(null),
    }),
  ),
);
const terminal = (toolCallId: string): ThreadToolEntry => ({
  type: 'tool',
  id: `tool:${toolCallId}`,
  toolName: 'work',
  toolCallId,
  toolInput: {},
  toolState: 'output-unknown',
  toolOutput: 'The invocation was stopped.',
  runId: 'run-1',
  occurredAt: '2026-10-10T00:00:00.000Z',
});
const recorded = Effect.fnUntraced(function* (entries: readonly ThreadToolEntry[], fail = false) {
  const journal = yield* ThreadEventJournal;
  const store = makeAggregateStorage();
  return yield* Effect.exit(
    store.writeAt(
      'thread-1',
      Effect.fnUntraced(function* (at) {
        for (const entry of entries) {
          const event = threadEntryEvent(entry);
          yield* journal.append({ threadId: 'thread-1', id: entry.id, ...event }, at.tx);
        }
        if (fail) return yield* Effect.fail('write refused');
      }),
    ),
  );
});
layer(threadToolSettlementsLayer.pipe(Layer.provide(ports)))('recorded tool settlements', (it) => {
  it.effect(
    'a terminal journal event releases its invocation only after the transaction commits',
    Effect.fnUntraced(function* () {
      const settlements = yield* ToolSettlements;
      if (settlements === undefined) return yield* Effect.die('The journal owns tool settlements.');
      const held = new Set(['read-back', 'door']);
      const identity = { toolCallId: 'call-1', caller: callerInThread('thread-1', 'run-1') };
      const claim = settlements.retain(
        identity,
        () => held.delete('read-back'),
        () => false,
      );
      settlements.retain(
        identity,
        () => held.delete('door'),
        () => false,
        'call',
      );
      claim?.ended();
      const before = yield* recorded([terminal('call-1')], true);
      expect(Exit.isFailure(before)).toBe(true);
      expect([...held]).toEqual(['read-back', 'door']);
      expect(settlements.size).toBe(1);
      const after = yield* recorded([terminal('call-1')]);
      expect(Exit.isSuccess(after)).toBe(true);
      expect([...held]).toEqual([]);
      expect(settlements.size).toBe(0);
    }),
  );
  it.effect(
    'recovery releases an effect whose terminal event committed before its stale transcript was settled',
    Effect.fnUntraced(function* () {
      const journal = yield* ThreadEventJournal;
      const settlements = yield* ToolSettlements;
      if (settlements === undefined) return yield* Effect.die('The journal owns tool settlements.');
      const store = makeAggregateStorage({ transcript: [terminal('call-1')] });
      store.historyOf = () => Effect.succeed(store.history);
      store.history = [Message.assistant([ToolCallPart.from({ id: 'call-1', name: 'work', input: {} })])];
      const held = new Set(['call-1']);
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Retain an interrupted effect.',
        parameters: Schema.Struct({}),
        execute: () => Effect.void,
        settleEffect: () => Effect.succeed({ status: 'completed', output: 'known effect' }),
        settled: ({ toolCallId }) => {
          held.delete(toolCallId);
        },
      });
      const result = yield* settleInterruptedEffects({
        kernel: { store, transitions: store, log: journal, kinds: makeThreadEntryReader({ products: [] }), lane: writerOrderedLane },
        run: { id: 'run-1', threadId: 'thread-1' },
        entries: [{ ...terminal('call-1'), toolState: 'input-available' }],
        catalog: { work: tool },
        caller: callerInThread('thread-1', 'run-1'),
      });
      expect(result.settled).toBe(0);
      expect([...held]).toEqual([]);
      expect(settlements.size).toBe(0);
      expect(store.transcript).toEqual([terminal('call-1')]);
    }),
  );
  it.effect(
    'a recorded run end drops foreground claims but keeps a detached invocation until delivery',
    Effect.fnUntraced(function* () {
      const settlements = yield* ToolSettlements;
      const journal = yield* ThreadEventJournal;
      if (settlements === undefined) return yield* Effect.die('The journal owns tool settlements.');
      const held = new Set(['foreground', 'background']);
      const claim = (toolCallId: string, detached: boolean) =>
        settlements.retain(
          { toolCallId, caller: callerInThread('thread-1', 'run-1') },
          () => held.delete(toolCallId),
          () => detached,
        );
      const foreground = claim('foreground', false);
      const background = claim('background', true);
      yield* recorded([terminal('background')]);
      const store = makeAggregateStorage();
      yield* store.writeAt('thread-1', (at) =>
        journal.append(
          {
            threadId: 'thread-1',
            id: 'run-end:run-1',
            kind: 'run-end',
            payload: {
              entry: {
                type: 'run-end',
                id: 'run-end:run-1',
                runId: 'run-1',
                status: 'aborted',
                startedAt: '2026-10-10T00:00:00.000Z',
                finishedAt: '2026-10-10T00:00:01.000Z',
                occurredAt: '2026-10-10T00:00:01.000Z',
              },
            },
          },
          at.tx,
        ),
      );
      expect(settlements.size).toBe(1);
      expect([...held]).toEqual(['foreground', 'background']);
      foreground?.ended();
      expect([...held]).toEqual(['background']);
      background?.ended();
      expect([...held]).toEqual(['background']);
      background?.delivered();
      expect([...held]).toEqual([]);
      expect(settlements.size).toBe(0);
    }),
  );
});
