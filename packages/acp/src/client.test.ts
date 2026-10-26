import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Result, Schema, Stream } from 'effect';
import { frame, type Envelope } from '@runlith/ndjson-rpc/envelope';
import { inbound, type ExchangeRead } from '@runlith/ndjson-rpc/exchange';
import * as Client from './client';
import type { ClientEvent, Intent, Outbound } from './events';
import { ClientState } from './state';

const encoder = new TextEncoder();

const lines = (...envelopes: ReadonlyArray<Envelope>): string => envelopes.map(frame).join('');

const update = (body: Record<string, unknown>): Envelope => ({
  _tag: 'Notification',
  method: 'session/update',
  params: { sessionId: 's1', update: body },
});

const said = (sessionUpdate: string, text: string): Envelope => update({ sessionUpdate, content: { type: 'text', text } });

const answered = (id: string, result: unknown): Envelope => ({ _tag: 'Result', id, result });

const permission = (id: number, toolCallId: string): Envelope => ({
  _tag: 'Request',
  id,
  method: 'session/request_permission',
  params: {
    sessionId: 's1',
    toolCall: { toolCallId, title: `edit ${toolCallId}`, kind: 'edit' },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  },
});

const prompt = (turn: string, envelopes: ReadonlyArray<string>): Intent => ({
  _tag: 'Prompt',
  turn,
  envelopes,
  params: { sessionId: 's1', prompt: [{ type: 'text', text: 'go' }] },
});

type Run = {
  readonly state: ClientState;
  readonly events: ReadonlyArray<ClientEvent>;
  readonly frames: ReadonlyArray<Outbound>;
  readonly persisted: ReadonlyArray<{ readonly snapshot: string; readonly events: number }>;
};

const fed = Effect.fnUntraced(function* (state: ClientState, script: string, from = state.cursor) {
  const bytes = encoder.encode(script);
  const read: ExchangeRead = (offset) => Stream.make(bytes.slice(Number(offset)));
  const items = yield* Stream.runCollect(inbound(read, from, 1024 * 1024));
  let current = state;
  const events: Array<ClientEvent> = [];
  const frames: Array<Outbound> = [];
  const persisted: Array<{ snapshot: string; events: number }> = [];
  for (const item of items) {
    const step = Client.receive(current, { _tag: 'Frame', inbound: item });
    current = step.state;
    events.push(...step.events);
    frames.push(...step.frames);
    if (step.durable) persisted.push({ snapshot: JSON.stringify(yield* Schema.encodeEffect(ClientState)(current)), events: events.length });
  }
  return { state: current, events, frames, persisted } satisfies Run;
});

const acted = (state: ClientState, ...intents: ReadonlyArray<Intent>): ClientState =>
  intents.reduce((current, intent) => Client.act(current, intent).state, state);

const tags = (events: ReadonlyArray<ClientEvent>): ReadonlyArray<string> => events.map((event) => event._tag);

const turnEnd = (events: ReadonlyArray<ClientEvent>) => events.find((event) => event._tag === 'TurnEnded');

describe('the ACP client machine', () => {
  it.effect('an external checkpoint commits the partial message and the same prompt continues without replaying its prefix', () =>
    Effect.gen(function* () {
      const prefix = lines(said('agent_message_chunk', 'before'));
      const current = yield* fed(acted(Client.start('checkpoint'), prompt('turn', ['words'])), prefix);
      const cut = Client.checkpoint(current.state);
      expect(cut).toMatchObject({
        durable: true,
        frames: [],
        events: [{ _tag: 'Message', turn: 'turn', message: { content: [{ type: 'text', text: 'before' }] } }],
      });
      expect(cut.state.turn?.message).toBeNull();
      const continued = yield* fed(
        cut.state,
        prefix + lines(said('agent_message_chunk', 'after'), answered('checkpoint:1', { stopReason: 'end_turn' })),
      );
      expect(continued.events.filter((event) => event._tag === 'Message')).toMatchObject([
        { message: { content: [{ type: 'text', text: 'after' }] } },
      ]);
      expect(turnEnd(continued.events)).toMatchObject({ delivery: 'accepted', envelopes: ['words'] });
    }),
  );

  it.effect('a $/ notification is a live signal of the open turn: it neither seals the open message nor asks for a durable step', () =>
    Effect.gen(function* () {
      const signal: Envelope = { _tag: 'Notification', method: '$/tagma/phase', params: { sessionId: 's1', phase: 'writing' } };
      const run = yield* fed(acted(Client.start('live'), prompt('turn', ['words'])), lines(said('agent_message_chunk', 'half'), signal));
      expect(run.events.at(-1)).toEqual({ _tag: 'Signaled', turn: 'turn', method: '$/tagma/phase', params: signal.params });
      expect(run.state.turn?.message).toMatchObject({ content: [{ type: 'text', text: 'half' }] });
      expect(run.persisted).toEqual([]);
    }),
  );

  test('an unstarted cancelled prompt ends cancelled and returns its known-unsent input', () => {
    const state = acted(Client.start('unsent'), prompt('turn', ['words']), { _tag: 'Cancel', params: { sessionId: 's1' } });
    const ended = Client.receive(state, { _tag: 'Unwritten', receipt: { _tag: 'Request', id: 'unsent:1' } });
    expect(turnEnd(ended.events)).toMatchObject({
      turn: 'turn',
      envelopes: ['words'],
      delivery: 'refused',
      outcome: { _tag: 'Stopped', stopReason: 'cancelled' },
    });
    expect(ended.state.requests).toEqual([]);
  });

  it.effect('a permission answer withdrawn before writing after cancel is replaced by cancellation without asking again', () =>
    Effect.gen(function* () {
      const asked = yield* fed(acted(Client.start('answer'), prompt('turn', [])), lines(permission(7, 'tool')));
      const selected = yield* Effect.fromResult(
        Client.answer(asked.state, 7, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: 'allow' } }),
      );
      const cancelled = Client.act(selected.state, { _tag: 'Cancel', params: { sessionId: 's1' } });
      const unsent = Client.receive(cancelled.state, { _tag: 'Unwritten', receipt: { _tag: 'Answer', id: 7 } });
      expect(unsent.frames.map((frame) => frame.envelope)).toEqual([
        { _tag: 'Result', id: 7, result: { outcome: { outcome: 'cancelled' } } },
      ]);
      expect(unsent.state.asks[0]?.answer).toEqual({ _tag: 'Result', result: { outcome: { outcome: 'cancelled' } } });
      expect(unsent.events.map((event) => event._tag)).toEqual(['Answered']);
    }),
  );

  it.effect('cancel reaches an extension-only operation and its cancellation response closes the durable request', () =>
    Effect.gen(function* () {
      const opened = Client.act(Client.start('compact'), {
        _tag: 'Extend',
        method: '_tagma/compact',
        params: { sessionId: 's1' },
        envelopes: [],
      });
      const cancel = Client.act(opened.state, { _tag: 'Cancel', params: { sessionId: 's1' } });
      expect(cancel.frames.map((out) => out.envelope)).toEqual([
        { _tag: 'Notification', method: 'session/cancel', params: { sessionId: 's1' } },
      ]);
      expect(cancel.request).toBeNull();
      const ended = yield* fed(cancel.state, lines({ _tag: 'Error', id: opened.request, error: { code: -32800, message: 'cancelled' } }));
      expect(ended.state.requests).toEqual([]);
      expect(ended.events).toMatchObject([
        {
          _tag: 'RequestFailed',
          request: { meaning: 'extension', method: '_tagma/compact', id: opened.request },
          cause: { _tag: 'Agent', error: { code: -32800 } },
        },
      ]);
    }),
  );

  it.effect('a declared notification is a durable boundary after the open message; prompt metadata survives without cumulative cost', () =>
    Effect.gen(function* () {
      const state = acted(Client.start('extensions'), { _tag: 'Extensions', methods: ['_tagma/compacted'] }, prompt('turn', []));
      const done = yield* fed(
        state,
        lines(
          said('agent_message_chunk', 'before compaction'),
          { _tag: 'Notification', method: '_tagma/compacted', params: { sessionId: 's1', summary: 'summary' } },
          update({ sessionUpdate: 'usage_update', used: 10, size: 20, cost: { amount: 99, currency: 'USD' } }),
          answered('extensions:1', {
            stopReason: 'end_turn',
            _meta: { 'tagma/turn': { prompt: 'uuid', last: 'last' }, 'tagma/cost': { amount: 0.1, currency: 'USD' } },
          }),
        ),
      );
      expect(tags(done.events).slice(0, 3)).toEqual(['Delta', 'Message', 'Extended']);
      expect(done.persisted).toHaveLength(2);
      expect(turnEnd(done.events)?.outcome).toEqual({
        _tag: 'Stopped',
        stopReason: 'end_turn',
        usage: null,
        meta: { 'tagma/turn': { prompt: 'uuid', last: 'last' }, 'tagma/cost': { amount: 0.1, currency: 'USD' } },
      });
    }),
  );

  it.effect(
    'a state persisted at a durable step resumes from its cursor to the same outcome, and frames before the cursor change nothing',
    () =>
      Effect.gen(function* () {
        const state = acted(Client.start('i1'), prompt('run-1', ['e1']));
        const script = lines(
          said('agent_message_chunk', 'Hel'),
          said('agent_message_chunk', 'lo'),
          update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read a.ts', kind: 'read', status: 'pending' }),
          update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { bytes: 3 } }),
          said('agent_message_chunk', 'Done'),
          answered('i1:1', { stopReason: 'end_turn' }),
        );
        const whole = yield* fed(state, script);
        const middle = whole.persisted[0]!;
        const restored = yield* Schema.decodeUnknownEffect(ClientState)(JSON.parse(middle.snapshot));
        const resumed = yield* fed(restored, script);
        const reread = yield* fed(restored, script, { offset: 0n, torn: false });
        expect(tags(whole.events.slice(middle.events))).toContain('TurnEnded');
        expect(resumed.events).toEqual(whole.events.slice(middle.events));
        expect(resumed.state).toEqual(whole.state);
        expect(reread.events).toEqual(resumed.events);
      }),
  );

  it.effect('requests outstanding on both sides settle by their own ids, in any order', () =>
    Effect.gen(function* () {
      const asked = yield* fed(acted(Client.start('i1'), prompt('run-1', ['e1'])), lines(permission(7, 't1'), permission(8, 't2')));
      const second = yield* Effect.fromResult(
        Client.answer(asked.state, 8, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: 'allow' } }),
      );
      const first = yield* Effect.fromResult(
        Client.answer(second.state, 7, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: 'reject' } }),
      );
      expect([...second.frames, ...first.frames].map((out) => out.envelope)).toEqual([
        { _tag: 'Result', id: 8, result: { outcome: { outcome: 'selected', optionId: 'allow' } } },
        { _tag: 'Result', id: 7, result: { outcome: { outcome: 'selected', optionId: 'reject' } } },
      ]);
      const again = Client.answer(first.state, 8, { _tag: 'Permission', outcome: { outcome: 'cancelled' } });
      const unknown = Client.answer(first.state, 9, { _tag: 'Result', result: {} });
      expect(Result.isFailure(again) && again.failure.reason).toBe('answered');
      expect(Result.isFailure(unknown) && unknown.failure.reason).toBe('unknown');
      const admitted = Client.receive(first.state, { _tag: 'Admitted', receipt: { _tag: 'Answer', id: 7 } }).state;
      expect(admitted.asks.map((ask) => ask.id)).toEqual([8]);
      const ended = yield* fed(
        admitted,
        lines(permission(7, 't1'), permission(8, 't2'), answered('i1:9', {}), answered('i1:1', { stopReason: 'end_turn' })),
      );
      expect(tags(ended.events)).toEqual(['Stray', 'ToolCallEnded', 'ToolCallEnded', 'TurnEnded']);
      expect(turnEnd(ended.events)).toMatchObject({
        turn: 'run-1',
        envelopes: ['e1'],
        delivery: 'accepted',
        outcome: { _tag: 'Stopped', stopReason: 'end_turn' },
      });
    }),
  );

  it.effect("a turn's chunks become one message ahead of the boundary after them, and updates after the answer are not the turn's", () =>
    Effect.gen(function* () {
      const run = yield* fed(
        acted(Client.start('i1'), prompt('run-1', ['e1'])),
        lines(
          said('agent_message_chunk', 'a'),
          said('agent_message_chunk', 'b'),
          update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run tests', kind: 'execute', status: 'in_progress' }),
          said('agent_thought_chunk', 'x'),
          answered('i1:1', { stopReason: 'end_turn', usage: { totalTokens: 3, inputTokens: 2, outputTokens: 1 } }),
          said('agent_message_chunk', 'late'),
        ),
      );
      const durable = run.events.filter((event) => event._tag !== 'Delta');
      expect(tags(durable)).toEqual(['Message', 'ToolCallStarted', 'Message', 'ToolCallEnded', 'TurnEnded', 'SessionChanged']);
      expect(durable[0]).toMatchObject({ turn: 'run-1', message: { stream: 'message', content: [{ type: 'text', text: 'ab' }] } });
      expect(durable[2]).toMatchObject({ message: { stream: 'thought', content: [{ type: 'text', text: 'x' }] } });
      expect(durable[4]).toMatchObject({ delivery: 'accepted', outcome: { _tag: 'Stopped', usage: { totalTokens: 3 } } });
      expect(run.state.turn).toBeNull();
    }),
  );

  it.effect('an error answer gives the words back only while the prompt is certain and no update of its turn arrived', () =>
    Effect.gen(function* () {
      const failed = (id: string): Envelope => ({ _tag: 'Error', id, error: { code: -32603, message: 'Internal error' } });
      const sent = acted(Client.start('i1'), prompt('run-1', ['e1']));
      const refused = yield* fed(sent, lines(failed('i1:1')));
      const working = yield* fed(sent, lines(said('agent_message_chunk', 'a'), failed('i1:1')));
      const unreadable = yield* fed(sent, lines(update({ sessionUpdate: 'compaction_update', phase: 'started' }), failed('i1:1')));
      const recovered = Client.receive(sent, { _tag: 'Recovered' });
      const unsure = yield* fed(recovered.state, lines(failed('i1:1')));
      expect(tags(recovered.events)).toEqual(['Uncertain']);
      expect(tags(unreadable.events)).toEqual(['Unrecognized', 'TurnEnded']);
      expect([refused, working, unreadable, unsure].map((run) => turnEnd(run.events))).toMatchObject([
        { delivery: 'refused', outcome: { _tag: 'Failed' } },
        { delivery: 'accepted', outcome: { _tag: 'Failed' } },
        { delivery: 'accepted', outcome: { _tag: 'Failed' } },
        { delivery: 'unconfirmed', outcome: { _tag: 'Failed' } },
      ]);
    }),
  );

  it.effect('an invalid permission request is answered invalid params from a recorded ask, so receipts and recovery find it', () =>
    Effect.gen(function* () {
      const run = yield* fed(
        acted(Client.start('i1'), prompt('run-1', ['e1'])),
        lines({ _tag: 'Request', id: 5, method: 'session/request_permission', params: { sessionId: 's1' } }),
      );
      expect(run.frames).toMatchObject([
        { receipt: { _tag: 'Answer', id: 5 }, envelope: { _tag: 'Error', id: 5, error: { code: -32602 } } },
      ]);
      expect(Client.receive(run.state, { _tag: 'Recovered' }).events).toMatchObject([{ _tag: 'Uncertain', asks: [{ id: 5 }] }]);
      expect(Client.receive(run.state, { _tag: 'Admitted', receipt: { _tag: 'Answer', id: 5 } }).state.asks).toEqual([]);
    }),
  );

  it.effect('an uncertain ask is never answered: cancel passes it by and an answer to it is refused', () =>
    Effect.gen(function* () {
      const asked = yield* fed(acted(Client.start('i1'), prompt('run-1', ['e1'])), lines(permission(3, 't1')));
      const gap = Client.receive(asked.state, { _tag: 'Gap', resume: 900n }).state;
      const cancelled = Client.act(gap, { _tag: 'Cancel', params: { sessionId: 's1' } });
      const answered = Client.answer(gap, 3, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: 'allow' } });
      expect(cancelled.frames.map((out) => out.envelope)).toEqual([
        { _tag: 'Notification', method: 'session/cancel', params: { sessionId: 's1' } },
      ]);
      expect(Result.isFailure(answered) && answered.failure.reason).toBe('uncertain');
    }),
  );

  it.effect('an agent request takes the open message to the journal before it is asked', () =>
    Effect.gen(function* () {
      const run = yield* fed(
        acted(Client.start('i1'), prompt('run-1', ['e1'])),
        lines(said('agent_message_chunk', 'Which file?'), {
          _tag: 'Request',
          id: 6,
          method: 'cursor/ask_question',
          params: { question: 'which?' },
        }),
      );
      expect(tags(run.events.filter((event) => event._tag !== 'Delta'))).toEqual(['Message', 'Asked']);
    }),
  );

  it.effect('an update to a call that already ended amends it instead of starting it again', () =>
    Effect.gen(function* () {
      const run = yield* fed(
        acted(Client.start('i1'), prompt('run-1', ['e1'])),
        lines(
          update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read a.ts', status: 'in_progress' }),
          update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' }),
          update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', rawOutput: { lines: 3 } }),
        ),
      );
      expect(tags(run.events)).toEqual(['ToolCallStarted', 'ToolCallEnded', 'ToolCallAmended']);
      expect(run.events[2]).toMatchObject({ turn: 'run-1', update: { toolCallId: 't1', rawOutput: { lines: 3 } } });
    }),
  );

  it.effect('a gap marks every outstanding request uncertain and resumes torn, and a late answer still settles its request', () =>
    Effect.gen(function* () {
      const sent = Client.receive(acted(Client.start('i1'), prompt('run-1', ['e1'])), {
        _tag: 'Admitted',
        receipt: { _tag: 'Request', id: 'i1:1' },
      }).state;
      const before = lines(permission(3, 't1'));
      const asked = yield* fed(sent, before);
      const gap = Client.receive(asked.state, { _tag: 'Gap', resume: 600n });
      expect(gap.events).toMatchObject([
        { _tag: 'Gapped', from: BigInt(encoder.encode(before).length), to: 600n },
        { _tag: 'Uncertain', requests: [{ id: 'i1:1', uncertain: true }], asks: [{ id: 3, uncertain: true }] },
      ]);
      expect(gap.state.cursor).toEqual({ offset: 600n, torn: true });
      const late = yield* fed(gap.state, `${before}${'y'.repeat(640)}\n${lines(answered('i1:1', { stopReason: 'end_turn' }))}`);
      expect(turnEnd(late.events)).toMatchObject({ turn: 'run-1', envelopes: ['e1'], delivery: 'accepted' });
      expect(late.state.requests).toEqual([]);
    }),
  );

  it.effect(
    'cancel answers the turn permission requests standing and arriving, and a process killed after cancel ends the worked turn cancelled with its words accepted',
    () =>
      Effect.gen(function* () {
        const before = lines(said('agent_message_chunk', 'half'), permission(4, 't1'));
        const asked = yield* fed(acted(Client.start('i1'), prompt('run-1', ['e1'])), before);
        const cancelled = Client.act(asked.state, { _tag: 'Cancel', params: { sessionId: 's1' } });
        expect(cancelled.frames.map((out) => out.envelope)).toEqual([
          { _tag: 'Notification', method: 'session/cancel', params: { sessionId: 's1' } },
          { _tag: 'Result', id: 4, result: { outcome: { outcome: 'cancelled' } } },
        ]);
        const arriving = yield* fed(cancelled.state, `${before}${lines(permission(5, 't2'))}`);
        expect(arriving.frames.map((out) => out.envelope)).toEqual([
          { _tag: 'Result', id: 5, result: { outcome: { outcome: 'cancelled' } } },
        ]);
        expect(tags(arriving.events)).toEqual(['ToolCallStarted', 'Answered']);
        const killed = Client.receive(arriving.state, { _tag: 'Exited', detail: 'the agent process died' });
        expect(turnEnd(killed.events)).toMatchObject({
          envelopes: ['e1'],
          delivery: 'accepted',
          outcome: { _tag: 'Stopped', stopReason: 'cancelled' },
        });
        expect(killed.state.requests).toEqual([]);
        expect(killed.state.asks).toEqual([]);
      }),
  );

  it.effect('history replayed by session/load or session/resume is drained, never projected', () =>
    Effect.gen(function* () {
      const replay = lines(
        said('user_message_chunk', 'old words'),
        said('agent_message_chunk', 'old answer'),
        update({ sessionUpdate: 'tool_call', toolCallId: 'old', title: 'Old', status: 'completed' }),
        answered('i2:1', { modes: null }),
      );
      const params = { sessionId: 's1', cwd: '/work', mcpServers: [] };
      const loaded = yield* fed(acted(Client.start('i2'), { _tag: 'LoadSession', params }), replay);
      const resumed = yield* fed(acted(Client.start('i2'), { _tag: 'ResumeSession', params }), replay);
      expect(loaded.events).toEqual([{ _tag: 'SessionReady', via: 'load', sessionId: 's1', setup: { modes: null } }]);
      expect(resumed.events).toEqual([{ _tag: 'SessionReady', via: 'resume', sessionId: 's1', setup: { modes: null } }]);
    }),
  );

  it.effect('a receipt lost by the host makes its request uncertain and settles its answer out of the state', () =>
    Effect.gen(function* () {
      const sent = acted(Client.start('i1'), prompt('run-1', ['e1']));
      const lost = Client.receive(sent, { _tag: 'Unknown', receipt: { _tag: 'Request', id: 'i1:1' } });
      expect(lost.events).toMatchObject([{ _tag: 'Uncertain', requests: [{ id: 'i1:1', uncertain: true }], asks: [] }]);
      const asked = yield* fed(lost.state, lines(permission(3, 't1')));
      const reply = yield* Effect.fromResult(
        Client.answer(asked.state, 3, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: 'allow' } }),
      );
      const unsure = Client.receive(reply.state, { _tag: 'Unknown', receipt: { _tag: 'Answer', id: 3 } });
      expect(unsure.events).toMatchObject([{ _tag: 'Uncertain', requests: [], asks: [{ id: 3, uncertain: true }] }]);
      expect(unsure.state.asks).toEqual([]);
      const failed = yield* fed(
        unsure.state,
        `${lines(permission(3, 't1'))}${lines({ _tag: 'Error', id: 'i1:1', error: { code: -32603, message: 'x' } })}`,
      );
      expect(turnEnd(failed.events)).toMatchObject({ delivery: 'accepted' });
    }),
  );

  test('a line over the ceiling fails the turn it belongs to, cancels it at the agent and reads on from the next line', () => {
    const sent = Client.receive(acted(Client.start('i1'), prompt('run-1', ['e1'])), {
      _tag: 'Admitted',
      receipt: { _tag: 'Request', id: 'i1:1' },
    }).state;
    const over = Client.receive(sent, { _tag: 'Oversized', start: 40n, ceiling: 1024, session: { sessionId: 's1' } });
    expect(turnEnd(over.events)).toMatchObject({
      turn: 'run-1',
      delivery: 'accepted',
      outcome: { _tag: 'Failed', cause: { _tag: 'Oversized', ceiling: 1024 } },
    });
    expect(over.frames.map((out) => out.envelope)).toEqual([
      { _tag: 'Notification', method: 'session/cancel', params: { sessionId: 's1' } },
    ]);
    expect(over.state.cursor).toEqual({ offset: 41n, torn: true });
    expect(over.state.requests).toEqual([]);
  });

  it.effect(
    'a process that dies gives back words it never got, leaves unconfirmed words it got silently, and accepts words it worked on',
    () =>
      Effect.gen(function* () {
        const unsent = acted(Client.start('i1'), prompt('run-1', ['e1']));
        const admitted = Client.receive(unsent, { _tag: 'Admitted', receipt: { _tag: 'Request', id: 'i1:1' } }).state;
        const worked = yield* fed(admitted, lines(said('agent_message_chunk', 'reading the task')));
        expect(turnEnd(Client.receive(unsent, { _tag: 'Exited', detail: 'gone' }).events)).toMatchObject({ delivery: 'refused' });
        expect(turnEnd(Client.receive(admitted, { _tag: 'Exited', detail: 'gone' }).events)).toMatchObject({ delivery: 'unconfirmed' });
        expect(turnEnd(Client.receive(worked.state, { _tag: 'Exited', detail: 'gone' }).events)).toMatchObject({ delivery: 'accepted' });
      }),
  );
});
