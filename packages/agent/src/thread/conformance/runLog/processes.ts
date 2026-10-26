import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, Schema, type Scope } from 'effect';
import { Tool } from '../../../agent/tool';
import { Message } from '@runlith/llm/schema/messages';
import type { ToolCatalog } from '../../../agent/ToolCatalog';
import { EFFECT_UNKNOWN_AFTER_DEATH } from '../../run/ThreadEffectSettlement';
import type { ThreadStorageFactory, ThreadStorageHarness } from '../storagePort';
import { threadCauseOf } from '../../ThreadBorder';
import { OWNER, SCOPE, type ScriptedInput, type ScriptedWorld, scriptedWorld, startedTurn, queuedTurn } from './world';
import { heldTurn, processTurn, replyTurn, steeredTurn, scriptedStep } from './scripts';
import { dyingToolTurn } from './toolScripts';
import { gate, request, transcriptOf, inboxQueued, spawnedThread, standingOf, until } from './support';
import { coreEntry } from '../../../transcript/kinds';
import { ASKS_NEVER } from '../../../permissions/vocabulary';
const beatenBy = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  runIds: readonly string[],
  threadId: string,
) {
  const standing = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(threadId, ['running']);
  if (!standing) return yield* Effect.die('The abandoned run is not running.');
  const holder = storage.runs({ ownerId: standing.ownerId, scope: SCOPE });
  return { at: (heartbeatAt: Date) => Effect.as(holder.writeHeartbeats(runIds, heartbeatAt), heartbeatAt) };
});
const reply = (text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text },
      { type: 'text-end', id: 't1' },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
const dies = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  threadId: string,
  world: ScriptedWorld,
) {
  world.plan.push(dyingToolTurn());
  const stream = yield* startedTurn(world, threadId, 'Write the file.');
  yield* until(() => Effect.map(transcriptOf(storage, threadId), (entries) => entries.some((entry) => entry.type === 'tool')));
  return stream;
});
export function describeThreadRunProcesses<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: the run over the log — processes that die and leave`, () => {
    test(
      'a run killed mid-tool resumes in a second process; the tool settles its own effect',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        let executions = 0;
        const held = new Set(['call-1']);
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () =>
              Effect.sync(() => {
                executions += 1;
                return { written: true };
              }),
            settleEffect: () => Effect.succeed({ status: 'completed' as const, output: { written: 'by the dead process' } }),
            settled: ({ toolCallId }) => {
              held.delete(toolCallId);
            },
          }),
        };
        const processA = yield* scriptedWorld(storage, thread.agentId, { catalog });
        yield* dies(storage, thread.id, processA);
        yield* processA.dispose();
        const processB = yield* scriptedWorld(storage, thread.agentId, { catalog });
        processB.plan.push(reply('Recovered and finished.'));
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const rowTranscript = yield* transcriptOf(storage, thread.id);
        expect(executions).toBe(0);
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolState: 'output-available', toolOutput: { written: 'by the dead process' } },
        ]);
        expect([...held]).toEqual([]);
        const toolMessages = (processB.replayed[0] ?? []).filter((message) => message.role === 'tool');
        expect(toolMessages).toHaveLength(1);
        expect(JSON.stringify(toolMessages[0])).toContain('call-1');
        expect(rowTranscript.findLast((entry) => entry.type === 'message')).toMatchObject({
          type: 'message',
          text: 'Recovered and finished.',
        });
      }),
    );
    test(
      'a restarted process seats the spawned run it adopts, so the host slots count it until it ends',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const parent = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* spawnedThread(storage, parent);
        const second = yield* spawnedThread(storage, parent);
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () => Effect.succeed({ written: true }),
            settleEffect: () => Effect.succeed({ status: 'completed' as const, output: { written: 'by the dead process' } }),
          }),
        };
        const early = yield* scriptedWorld(storage, parent.agentId, { catalog });
        yield* dies(storage, second.id, early);
        yield* early.dispose();
        const cutting = yield* scriptedWorld(storage, parent.agentId, { catalog, rhythm: { resumeWithinMs: 0 } });
        expect(yield* cutting.harness.runs.recoverNow()).toBe(1);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(second.id)).toMatchObject({ status: 'cut' });
        const dying = yield* scriptedWorld(storage, parent.agentId, { catalog });
        yield* dies(storage, first.id, dying);
        yield* dying.dispose();
        const restarted = yield* scriptedWorld(storage, parent.agentId, { catalog, spawnSlots: 1 });
        const finish = gate();
        restarted.plan.push(processTurn(finish.released));
        expect(yield* restarted.harness.runs.recoverNow()).toBe(1);
        expect(yield* Effect.flip(restarted.harness.threads.handle(second.id, OWNER).continue())).toMatchObject({
          _tag: 'ThreadCallBroke',
          cause: expect.any(Error),
        });
        finish.release();
        yield* until(() => Effect.map(storage.aggregate.find(first.id), (row) => row?.status === 'idle'));
        restarted.plan.push(processTurn(Effect.void));
        expect((yield* restarted.harness.threads.handle(second.id, OWNER).continue()).runId).toBeTruthy();
      }),
    );
    test(
      'a run abandoned inside the takeover grace is taken over one grace later, and answers its reader again',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, thread.agentId);
        const GRACE_MS = 60_000;
        processA.plan.push(heldTurn(Effect.never));
        const held = yield* startedTurn(processA, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        const reached = gate();
        const drainSeen = gate();
        let drained: readonly string[] = [];
        const processB = yield* scriptedWorld(storage, thread.agentId, {
          rhythm: { heartbeatIntervalMs: 25, takeoverAfterMs: GRACE_MS, staleRunningAfterMs: 30_000, staleSweepIntervalMs: 30_000 },
        });
        processB.plan.push(
          steeredTurn({
            reached: reached.reach,
            released: reached.released,
            onDrained: (texts) => {
              drained = texts;
            },
            drainSeen: { reached: drainSeen.reach, released: drainSeen.released },
          }),
        );
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const beating = yield* beatenBy(storage, [held.runId], thread.id);
        yield* beating.at(new Date(yield* Clock.currentTimeMillis));
        expect(yield* processB.harness.runs.recoverNow()).toBe(0);
        expect((yield* runsPort.latestRun(thread.id, ['running']))?.resumes).toBe(0);
        const silentSince = yield* beating.at(new Date((yield* Clock.currentTimeMillis) - GRACE_MS - 1));
        expect(yield* processB.harness.runs.recoverNow()).toBeGreaterThan(0);
        yield* until(() => Effect.map(runsPort.latestRun(thread.id, ['running']), (row) => (row?.resumes ?? 0) > 0));
        const adopted = yield* runsPort.latestRun(thread.id, ['running']);
        if (!adopted) return yield* Effect.die('The adopted run disappeared under the proof.');
        expect(adopted.id).toBe(held.runId);
        expect(adopted.heartbeatAt.getTime()).toBeGreaterThan(silentSince.getTime() + GRACE_MS);
        yield* reached.reached;
        expect(
          yield* processB.harness.threads.handle(thread.id, OWNER).steer({ expectedRunId: adopted.id, text: 'Use the other table.' }),
        ).toMatchObject({ status: 'steered', runId: adopted.id });
        reached.release();
        yield* drainSeen.reached;
        expect(drained).toEqual(['Use the other table.']);
        expect(yield* inboxQueued(storage, thread.id, 'signal')).toHaveLength(0);
        expect(yield* processB.harness.threads.handle(thread.id, OWNER).stop()).toMatchObject({ status: 'stopped' });
        drainSeen.release();
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status !== 'running'));
        expect((yield* runsPort.latestRun(thread.id))?.status).not.toBe('running');
      }),
    );
    test(
      'a recovery pass is not held by an adopted run that says nothing: every abandoned run is decided',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const early = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const late = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, early.agentId);
        const GRACE_MS = 100;
        processA.plan.push(heldTurn(Effect.never), heldTurn(Effect.never));
        for (const thread of [early, late]) {
          yield* startedTurn(processA, thread.id, 'Begin.');
          yield* until(() =>
            Effect.map(transcriptOf(storage, thread.id), (entries) =>
              entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
            ),
          );
        }
        const processB = yield* scriptedWorld(storage, early.agentId, {
          rhythm: {
            heartbeatIntervalMs: 25,
            takeoverAfterMs: GRACE_MS,
            staleRunningAfterMs: 30_000,
            staleSweepIntervalMs: 30_000,
            recoveryBatch: 2,
          },
        });
        const driven = (input: ScriptedInput) => (input.thread.id === late.id ? processTurn(Effect.never) : reply('Decided.'))(input);
        processB.plan.push(driven, driven);
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const runIds = yield* Effect.forEach(
          [early, late],
          Effect.fnUntraced(function* (thread) {
            const run = yield* runsPort.latestRun(thread.id, ['running']);
            if (!run) return yield* Effect.die('A run that should be abandoned is not running.');
            return run.id;
          }),
        );
        const beating = yield* beatenBy(storage, runIds, early.id);
        yield* beating.at(new Date((yield* Clock.currentTimeMillis) + 60_000));
        expect(yield* processB.harness.runs.recoverNow()).toBe(0);
        yield* beating.at(new Date((yield* Clock.currentTimeMillis) - GRACE_MS - 1));
        expect(yield* processB.harness.runs.recoverNow()).toBeGreaterThan(0);
        yield* until(() => Effect.map(runsPort.latestRun(late.id, ['running']), (row) => (row?.resumes ?? 0) > 0));
        yield* until(() => Effect.map(storage.aggregate.find(early.id), (row) => row?.status === 'idle'));
        expect(yield* runsPort.latestRun(early.id)).toMatchObject({ status: 'completed', resumes: 0 });
        expect((yield* runsPort.latestRun(late.id))?.status).toBe('running');
      }),
    );
    test(
      'an effect no tool can answer settles as a synthetic abort, and the run still completes',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        let executions = 0;
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () =>
              Effect.sync(() => {
                executions += 1;
                return { written: true };
              }),
          }),
        };
        const processA = yield* scriptedWorld(storage, thread.agentId, { catalog });
        yield* dies(storage, thread.id, processA);
        yield* processA.dispose();
        const processB = yield* scriptedWorld(storage, thread.agentId, { catalog });
        processB.plan.push(reply('Noted the loss.'));
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const rowTranscript = yield* transcriptOf(storage, thread.id);
        expect(executions).toBe(0);
        expect(rowTranscript.filter((entry) => entry.type === 'tool')).toMatchObject([
          { toolState: 'output-unknown', toolOutput: EFFECT_UNKNOWN_AFTER_DEATH },
        ]);
        expect(JSON.stringify((processB.replayed[0] ?? []).filter((message) => message.role === 'tool'))).toContain(
          EFFECT_UNKNOWN_AFTER_DEATH,
        );
        expect(rowTranscript.findLast((entry) => entry.type === 'message')).toMatchObject({ type: 'message', text: 'Noted the loss.' });
      }),
    );
    test(
      'a departing process hands its run over, and the next one adopts it with no grace elapsed',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () => Effect.succeed({ written: true }),
            settleEffect: () => Effect.succeed({ status: 'completed' as const, output: { written: 'before the handover' } }),
          }),
        };
        const processA = yield* scriptedWorld(storage, thread.agentId, { catalog });
        const stream = yield* dies(storage, thread.id, processA);
        yield* processA.dispose();
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const left = yield* runsPort.latestRun(thread.id);
        expect(left).toMatchObject({ id: stream.runId, status: 'running' });
        expect(left?.handedOverAt).not.toBeNull();
        const processB = yield* scriptedWorld(storage, thread.agentId, { catalog, rhythm: { takeoverAfterMs: 60_000 } });
        processB.plan.push(reply('Taken up and finished.'));
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const finished = yield* runsPort.latestRun(thread.id);
        expect(finished).toMatchObject({ id: stream.runId, status: 'completed' });
        const rowTranscript = yield* transcriptOf(storage, thread.id);
        expect(rowTranscript.findLast((entry) => entry.type === 'message')).toMatchObject({
          type: 'message',
          text: 'Taken up and finished.',
        });
        expect(rowTranscript.at(-1)).toMatchObject({
          type: 'run-end',
          runId: stream.runId,
          status: 'completed',
          startedAt: left!.startedAt.toISOString(),
          finishedAt: finished!.finishedAt!.toISOString(),
        });
      }),
    );
    test(
      'a run whose gap is past the window ends cut, keeps its queue, and one verb continues it',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () => Effect.succeed({ written: true }),
            settleEffect: () => Effect.succeed({ status: 'completed' as const, output: { written: 'before the cut' } }),
          }),
        };
        const processA = yield* scriptedWorld(storage, thread.agentId, { catalog });
        const stream = yield* dies(storage, thread.id, processA);
        const waiting = yield* queuedTurn(processA.harness.threads.handle(thread.id, OWNER), 'And then the tests.');
        expect(waiting.runId).toBe(stream.runId);
        yield* storage.inbox.put(request('envelope:asked', thread.id, 'Write the file.', 1_000));
        yield* storage.inbox.deliver(['envelope:asked'], stream.runId);
        yield* processA.dispose();
        const cutEvents: string[] = [];
        const processB = yield* scriptedWorld(storage, thread.agentId, {
          catalog,
          rhythm: { resumeWithinMs: 0 },
          onSettled: (event) => Effect.asVoid(Effect.sync(() => cutEvents.push(`${event.runId}:${event.status}`))),
        });
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const cut = yield* runsPort.latestRun(thread.id);
        expect(cut).toMatchObject({ id: stream.runId, status: 'cut', failureReason: null, failure: null });
        expect(cut?.finishedAt).not.toBeNull();
        expect(cutEvents).toContain(`${stream.runId}:cut`);
        expect((yield* storage.aggregate.find(thread.id))?.status).toBe('idle');
        const held = yield* processB.harness.reads.snapshot(thread.id);
        expect(held.activeRun).toBeNull();
        expect(held.pendingInput.queued.map((turn) => turn.text)).toEqual(['And then the tests.']);
        const afterCut = yield* transcriptOf(storage, thread.id);
        expect(afterCut.some((entry) => entry.type === 'interruption')).toBe(true);
        expect(
          afterCut.filter(
            (entry) =>
              entry.type === 'tool' &&
              (
                entry as {
                  toolState?: string;
                }
              ).toolState === 'input-available',
          ),
        ).toHaveLength(0);
        processB.plan.push(reply('Continued.'));
        const continued = yield* processB.harness.threads.handle(thread.id, OWNER).continue();
        expect(continued.runId).not.toBe(stream.runId);
        yield* until(() => Effect.map(storage.aggregate.find(thread.id), (row) => row?.status === 'idle'));
        const afterContinue = yield* transcriptOf(storage, thread.id);
        expect(
          afterContinue.filter(
            (entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'user' && entry.text === 'And then the tests.',
          ),
        ).toHaveLength(1);
        expect(yield* inboxQueued(storage, thread.id, 'turn')).toHaveLength(0);
        yield* until(() => Effect.map(standingOf(storage, 'envelope:asked'), (receipt) => receipt?.state === 'acknowledged'));
        expect(yield* standingOf(storage, 'envelope:asked')).toEqual({ state: 'acknowledged', runId: continued.runId });
        expect(threadCauseOf(yield* Effect.flip(processB.harness.threads.handle(thread.id, OWNER).continue()))).toMatchObject({
          _tag: 'ThreadRunNotInterrupted',
          status: 'completed',
        });
      }),
    );
    test(
      'two orderly restarts mid-tool preserve the run without spending crash recovery attempts',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const catalog: ToolCatalog = {
          write_file: Tool.make({
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            description: 'Write a file.',
            parameters: Schema.Struct({ path: Schema.String }),
            execute: () => Effect.succeed({ written: true }),
            settleEffect: () => Effect.succeed({ status: 'completed' as const, output: { written: 'before the handover' } }),
          }),
        };
        const first = yield* scriptedWorld(storage, thread.agentId, { catalog });
        const stream = yield* dies(storage, thread.id, first);
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const endings: string[] = [];
        let current = first;
        for (let restart = 0; restart < 2; restart += 1) {
          yield* current.dispose();
          expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: stream.runId, status: 'running', handedOverAt: expect.any(Date) });
          current = yield* scriptedWorld(storage, thread.agentId, {
            catalog,
            rhythm: { takeoverAfterMs: 100 },
            onSettled: (event) => Effect.asVoid(Effect.sync(() => endings.push(event.status))),
          });
          current.plan.push(processTurn(Effect.never));
          expect(yield* current.harness.runs.recoverNow()).toBe(1);
          expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: stream.runId, status: 'running', handedOverAt: null, resumes: 0 });
          expect((yield* current.harness.reads.snapshot(thread.id)).activeRun?.id).toBe(stream.runId);
        }
        expect(endings).toEqual([]);
      }),
    );
    test(
      'an orderly restart hands over a run whose stop still stands, and the next server ends it at once and opens the next turn',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* scriptedWorld(storage, thread.agentId, { rhythm: { heartbeatIntervalMs: 60_000 } });
        first.plan.push(heldTurn(Effect.never));
        const stream = yield* startedTurn(first, thread.id, 'Begin.');
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        yield* runs.requestStop(stream.runId, { by: 'reader', marker: true, withdraw: false }, new Date(yield* Clock.currentTimeMillis));
        yield* first.dispose();
        const next = yield* scriptedWorld(storage, thread.agentId, { rhythm: { takeoverAfterMs: 60_000 } });
        yield* next.harness.runs.recoverNow();
        expect(yield* runs.runById(stream.runId)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
        next.plan.push(reply('Next.'));
        const opened = yield* startedTurn(next, thread.id, 'Go on.');
        expect(opened.runId).not.toBe(stream.runId);
      }),
    );
    test(
      'a recovery abandoned without progress exhausts its crash budget and is cut with the reason',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const first = yield* scriptedWorld(storage, thread.agentId);
        first.plan.push(heldTurn(Effect.never));
        const stream = yield* startedTurn(first, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(transcriptOf(storage, thread.id), (entries) =>
            entries.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        const recovering = yield* scriptedWorld(storage, thread.agentId);
        recovering.plan.push(processTurn(Effect.never));
        expect(yield* recovering.harness.runs.recoverNow()).toBe(1);
        const runs = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: stream.runId, status: 'running', resumes: 1 });
        const successor = yield* scriptedWorld(storage, thread.agentId);
        expect(yield* successor.harness.runs.recoverNow()).toBe(1);
        expect(yield* runs.latestRun(thread.id)).toMatchObject({ id: stream.runId, status: 'cut', failureReason: expect.any(String) });
        expect((yield* transcriptOf(storage, thread.id)).findLast((entry) => entry.type === 'interruption')).toMatchObject({
          runId: stream.runId,
          text: expect.any(String),
        });
      }),
    );
  });
}
