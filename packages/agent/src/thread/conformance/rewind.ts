import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Deferred, Effect, type Scope } from 'effect';
import { route as anthropicRoute } from '@runlith/llm/protocols/anthropic-messages';
import { route as openAIRoute } from '@runlith/llm/protocols/openai-responses';
import { prepare } from '@runlith/llm/route/client';
import { LLMRequest, Message, ToolResultPart } from '@runlith/llm/schema/messages';
import { Model } from '@runlith/llm/schema/options';
import { withAgentOrigin } from '../../agent/AgentSignal';
import { foldThreadTranscript } from '../../transcript/eventFold';
import type { ThreadCompactionEntry } from '../../transcript/entries';
import type { ThreadTranscript } from '../../transcript/rows';
import { threadCompactionEvent, threadSignalOpening } from '../events';
import { actDigest, callKey } from '../keyed';
import { pairedForProvider } from '../run/toolPairing';
import type { ThreadState } from '../state';
import { threadCauseOf } from '../ThreadBorder';
import { threadWireDeltas } from '../ThreadWireDeltas';
import { hangingTurn, replyTurn, scriptedStep } from './runLog/scripts';
import { gate, transcriptOf } from './runLog/support';
import { type ScriptedTurn, type ScriptedWorld, scriptedWorld, openedRun, startedTurn, pump } from './runLog/world';
import type { ThreadStorageFactory, ThreadStorageHarness } from './storagePort';
import { appendEvent } from './storagePort/support';
const OWNER = 'owner';
export function describeThreadRewind<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: rewinding a thread`, () => {
    test(
      'a dropped middle turn leaves exactly its run’s messages out of the next request, and restore puts the history back byte for byte',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* answered(world, thread.id, 'One.', reply('Did one.'));
        const probing = yield* answered(world, thread.id, 'Two.', probe());
        yield* answered(world, thread.id, 'Three.', reply('Did three.'));
        const before = yield* historyOf(storage, thread.id);
        const dropped = yield* handle.rewind({ at: probing, scope: 'turn' });
        expect(dropped).toMatchObject({ runIds: [probing], draft: { text: 'Two.' }, taken: [], stopped: null });
        const kept = yield* historyOf(storage, thread.id);
        expect(textsOf(kept)).toEqual(['One.', 'Did one.', 'Three.', 'Did three.']);
        expect(pairedForProvider(kept)).toEqual(kept);
        expect(marksOf(yield* transcriptOf(storage, thread.id))).toEqual({ [probing]: [{ by: dropped.rewindId, scope: 'turn' }] });
        expect(yield* handle.rewindPoints()).toMatchObject({
          points: [{ rewindable: true }, { runId: probing, rewindable: false, reason: 'rewind-rewound' }, { rewindable: true }],
          rewinds: [{ rewindId: dropped.rewindId, scope: 'turn', runIds: [probing], restorable: true }],
        });
        yield* handle.restore({ rewindId: dropped.rewindId });
        expect(yield* historyOf(storage, thread.id)).toEqual(before);
        expect(marksOf(yield* transcriptOf(storage, thread.id))).toEqual({});
        const again = yield* handle.rewind({ at: probing, scope: 'turn' });
        yield* answered(world, thread.id, 'Four.', reply('Did four.'));
        const sent = world.replayed.at(-1)!;
        expect(textsOf(sent)).toEqual(['One.', 'Did one.', 'Three.', 'Did three.', 'Four.']);
        expect(pairedForProvider(sent)).toEqual(sent);
        expect(threadCauseOf(yield* Effect.flip(handle.restore({ rewindId: again.rewindId })))).toMatchObject({
          _tag: 'ThreadRewindRefused',
          code: 'restore-superseded',
        });
      }),
    );
    test(
      'a rewind from a turn takes it and every later turn out, keeps pinned context, hands its words back and reaches a resuming reader as marks',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        yield* answered(world, thread.id, 'One.', reply('Did one.'));
        const second = yield* answered(world, thread.id, 'Two.', reply('Did two.'));
        yield* handle.attachContext({ title: 'Release notes', text: 'Nothing breaks.' });
        const third = yield* answered(world, thread.id, 'Three.', reply('Did three.'));
        const held = yield* transcriptOf(storage, thread.id);
        const heldAt = yield* storage.eventLog.headPosition(thread.id);
        const rewound = yield* handle.rewind({ at: second, scope: 'from' });
        expect(rewound).toMatchObject({ runIds: [second, third], draft: { text: 'Two.' } });
        const kept = yield* historyOf(storage, thread.id);
        expect(textsOf(kept).slice(0, 2)).toEqual(['One.', 'Did one.']);
        expect(kept).toHaveLength(3);
        expect(textsOf(kept)[2]).toContain('Nothing breaks.');
        const mark = { by: rewound.rewindId, scope: 'from' };
        const transcript = yield* transcriptOf(storage, thread.id);
        expect(marksOf(transcript)).toEqual({ [second]: [mark], [third]: [mark] });
        expect(transcript.filter((entry) => entry.type === 'signal').map((entry) => entry.rewound)).toEqual([undefined]);
        expect((yield* storage.aggregate.find(thread.id))?.contextReading?.staleBy ?? 'rewind').toBe('rewind');
        const deltas = (yield* threadWireDeltas(storage.eventLog, storage.kinds, thread.id, heldAt)) ?? [];
        expect(deltas.flatMap((delta) => (delta.rewound ? [delta.rewound] : []))).toEqual([
          { id: rewound.rewindId, scope: 'from', runIds: [second, third] },
        ]);
        expect(deltas.reduce<ThreadTranscript>((folded, delta) => foldThreadTranscript(folded, delta), held)).toEqual(transcript);
        yield* answered(world, thread.id, 'Four.', reply('Did four.'));
        const sent = world.replayed.at(-1)!;
        expect(textsOf(sent).slice(-2)).toEqual([textsOf(kept)[2]!, 'Four.']);
        for (const [provider, route] of [
          ['anthropic', anthropicRoute],
          ['openai', openAIRoute],
        ] as const) {
          const body = JSON.stringify(
            (yield* prepare(
              new LLMRequest({ model: Model.make({ id: 'model-test', provider, route }), system: [], messages: sent, tools: [] }),
            )).body,
          );
          expect([body.includes('Nothing breaks.'), body.includes('Four.'), body.includes('Two.'), body.includes('Did three.')]).toEqual([
            true,
            true,
            false,
            false,
          ]);
        }
      }),
    );
    test(
      'a turn a compaction summarized refuses rewind-summarized, and so does a branch before it',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const first = yield* answered(world, thread.id, 'One.', reply('Did one.'));
        const second = yield* answered(world, thread.id, 'Two.', reply('Did two.'));
        yield* handle.append([summarized(2)]);
        expect(threadCauseOf(yield* Effect.flip(handle.rewind({ at: first, scope: 'from' })))).toMatchObject({
          _tag: 'ThreadRewindRefused',
          code: 'rewind-summarized',
        });
        expect(
          threadCauseOf(
            yield* Effect.flip(
              world.harness.threads.duplicate({ ownerId: OWNER, sourceThreadId: thread.id, cut: { kind: 'before', runId: first } }),
            ),
          ),
        ).toMatchObject({ _tag: 'ThreadRewindRefused', code: 'rewind-summarized' });
        expect((yield* handle.rewindPoints()).points).toEqual([
          { runId: first, rewindable: false, reason: 'rewind-summarized' },
          { runId: second, rewindable: true },
        ]);
        expect(textsOf(yield* historyOf(storage, thread.id))).toEqual(['Summary follows.', 'Summary.', 'Two.', 'Did two.']);
      }),
    );
    test(
      'a rewind over a going run stops it first, hands back the words queued behind it, and leaves nothing to start',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const reached = gate();
        world.plan.push(hangingTurn({ chunks: [{ type: 'text-start', id: 'held' }], reached: reached.reach }));
        const going = (yield* startedTurn(world, thread.id, 'Two.')).runId;
        yield* reached.reached;
        expect((yield* handle.queue('Later.')).status).toBe('queued');
        const rewound = yield* handle.rewind({ at: going, scope: 'from' });
        expect(rewound).toMatchObject({ stopped: going, runIds: [going], draft: { text: 'Two.' }, taken: [{ text: 'Later.' }] });
        expect(textsOf(yield* historyOf(storage, thread.id))).toEqual([]);
        expect((yield* world.harness.reads.snapshot(thread.id)).activeRun).toBeNull();
        expect((yield* storage.inbox.pending(thread.id)).filter((item) => item.state === 'queued')).toEqual([]);
        expect(world.plan).toHaveLength(0);
      }),
    );
    test(
      'words sent while a hold on the thread`s run admission stands wait queued, and open their turn when it lifts',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const first = yield* answered(world, thread.id, 'One.', reply('Did one.'));
        const release = world.admission.hold([thread.id]);
        try {
          expect(yield* world.harness.threads.handle(thread.id, OWNER).send('Two.')).toMatchObject({ status: 'queued', runId: first });
          expect((yield* world.harness.reads.snapshot(thread.id)).pendingInput.queued).toMatchObject([{ text: 'Two.' }]);
          world.plan.push(reply('Did two.'));
        } finally {
          release();
        }
        yield* settled(world, thread.id, (state) => state.latestRun !== null && state.latestRun.id !== first);
        expect(textsOf(yield* historyOf(storage, thread.id))).toEqual(['One.', 'Did one.', 'Two.', 'Did two.']);
        expect((yield* storage.inbox.pending(thread.id)).filter((item) => item.state === 'queued')).toEqual([]);
      }),
    );
    test(
      'a hold on one harness`s run admission is not seen by another harness in the same process',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const other = yield* scriptedWorld(storage, thread.agentId);
        const release = world.admission.hold([thread.id]);
        try {
          other.plan.push(reply('Did one.'));
          yield* pump(yield* startedTurn(other, thread.id, 'One.'));
          expect(textsOf(yield* historyOf(storage, thread.id))).toEqual(['One.', 'Did one.']);
        } finally {
          release();
        }
      }),
    );
    test(
      'a branch before a turn carries the history as it stood before it, answers a retry under its key with the same thread, and leaves its source untouched',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        yield* answered(world, thread.id, 'One.', reply('Did one.'));
        const second = yield* answered(world, thread.id, 'Two.', probe());
        const third = yield* answered(world, thread.id, 'Three.', reply('Did three.'));
        const head = yield* storage.eventLog.headPosition(thread.id);
        const history = yield* historyOf(storage, thread.id);
        const birth = {
          evidence: { call: callKey({ operation: 'branch', actor: OWNER, key: 'branch-1' }) },
          digest: actDigest(['branch', thread.id, second]),
        };
        const branching = () =>
          world.harness.threads.duplicate({ ownerId: OWNER, sourceThreadId: thread.id, cut: { kind: 'before', runId: second }, birth });
        const branch = yield* branching();
        expect((yield* branching()).id).toBe(branch.id);
        expect(textsOf(yield* historyOf(storage, branch.id))).toEqual(['One.', 'Did one.']);
        expect((yield* transcriptOf(storage, branch.id)).some((entry) => entry.runId === second || entry.runId === third)).toBe(false);
        expect(yield* storage.eventLog.headPosition(thread.id)).toBe(head);
        expect(yield* historyOf(storage, thread.id)).toEqual(history);
      }),
    );
    test(
      'the words a turn opened with come back whole, every task of another agent among them',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const task = (id: string, text: string) =>
          threadSignalOpening(
            {
              id,
              type: 'task',
              addressee: 'transport',
              text,
              from: 'lead',
              senderThreadId: 'thread-lead',
              occurredAt: new Date(0).toISOString(),
            },
            'run-tasked',
            text,
          );
        for (const [at, event] of [task('task-1', 'Map the module.'), task('task-2', 'Then list its callers.')].entries())
          yield* appendEvent(storage, { threadId: thread.id, id: `${thread.id}:tasked:${at}`, kind: event.kind, payload: event.payload });
        expect(yield* world.harness.threads.handle(thread.id, OWNER).turnDraft('run-tasked')).toEqual({
          text: 'Map the module.\nThen list its callers.',
        });
      }),
    );
  });
}
const answered = Effect.fnUntraced(function* (world: ScriptedWorld, threadId: string, text: string, turn: ScriptedTurn) {
  world.plan.push(turn);
  const started = yield* startedTurn(world, threadId, text);
  yield* pump(started);
  return started.runId;
});
const settled = Effect.fnUntraced(function* (world: ScriptedWorld, threadId: string, which: (state: ThreadState) => boolean) {
  yield* Effect.scoped(
    Effect.gen(function* () {
      const finished = yield* Deferred.make<void>();
      const over = (state: ThreadState) =>
        which(state) && state.latestRun !== null && state.latestRun.status !== 'running' && state.latestRun.settledNotifiedAt !== null;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          world.harness.reads.subscribe(threadId, (event) => {
            if (event.type === 'state' && over(event.frame.state)) Deferred.doneUnsafe(finished, Effect.void);
          }),
        ),
        (detach) => Effect.sync(detach),
      );
      if (!over(yield* world.harness.reads.snapshot(threadId))) yield* Deferred.await(finished);
    }),
  );
});
function reply(text: string): ScriptedTurn {
  return replyTurn({
    chunks: [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text },
      { type: 'text-end', id: 't1' },
      { type: 'run-finish' },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
}
function probe(): ScriptedTurn {
  const call = { toolCallId: 'call-probe', toolName: 'graph_probe', input: { block: 'one' } };
  return replyTurn({
    chunks: [
      { type: 'tool-call', id: call.toolCallId, name: call.toolName, input: call.input },
      { type: 'text-start', id: 't2' },
      { type: 'text-delta', id: 't2', text: 'Probed.' },
      { type: 'text-end', id: 't2' },
      { type: 'tool-result', id: call.toolCallId, name: call.toolName, result: { type: 'json', value: { ok: true } } },
      { type: 'run-finish' },
    ],
    steps: [
      scriptedStep({
        text: '',
        messages: [
          Message.assistant([{ type: 'tool-call', id: call.toolCallId, name: call.toolName, input: call.input }]),
          Message.tool(ToolResultPart.from({ id: call.toolCallId, name: call.toolName, result: { ok: true } })),
        ],
        toolCalls: [call],
        toolResults: [{ toolCallId: call.toolCallId, toolName: call.toolName, output: { ok: true } }],
      }),
      scriptedStep({ text: 'Probed.', messages: [Message.assistant('Probed.')] }),
    ],
  });
}
function summarized(covered: number) {
  const entry: ThreadCompactionEntry = { type: 'compaction', id: 'compaction:appended', mode: 'manual', status: 'completed' };
  return threadCompactionEvent(entry, {
    keepFrom: covered,
    messages: [withAgentOrigin(Message.user('Summary follows.'), 'summary'), withAgentOrigin(Message.assistant('Summary.'), 'summary')],
  });
}
const historyOf = <TTx, TWrite extends TTx>(storage: ThreadStorageHarness<TTx, TWrite>, threadId: string) =>
  Effect.map(storage.aggregate.find(threadId), (row) => row?.history ?? []);
function marksOf(transcript: ThreadTranscript): Record<string, readonly unknown[]> {
  const marks: Record<string, unknown[]> = {};
  for (const entry of transcript) {
    const mark = entry.rewound;
    if (mark === undefined || entry.runId === undefined) continue;
    const held = (marks[entry.runId] ??= []);
    if (!held.some((seen) => JSON.stringify(seen) === JSON.stringify(mark))) held.push(mark);
  }
  return marks;
}
function textsOf(messages: readonly Message[]): readonly string[] {
  return messages.map((message) => message.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join(''));
}
