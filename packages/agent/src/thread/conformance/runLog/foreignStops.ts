import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadStorageFactory } from '../storagePort';
import { readThreadEvents } from '../../events';
import { OWNER, SCOPE, scriptedWorld, pump, startedTurn } from './world';
import { hangingTurn, heldTurn, replyTurn, scriptedStep } from './scripts';
import { gate, until } from './support';
import { coreEntry } from '../../../transcript/kinds';
export function describeThreadRunForeignStops<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a stop from a process that does not hold the run`, () => {
    test(
      'a reader`s stop ends a run whose owner no longer answers, and their next words open a turn',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* scriptedWorld(storage, thread.agentId);
        processA.plan.push(heldTurn(Effect.never));
        const held = yield* startedTurn(processA, thread.id, 'Begin.');
        yield* until(() =>
          Effect.map(storage.aggregate.transcriptOf(thread.id), (entries) =>
            (entries ?? []).some((entry) => coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant'),
          ),
        );
        const processB = yield* scriptedWorld(storage, thread.agentId);
        expect(yield* processB.harness.threads.handle(thread.id, OWNER).stop()).toEqual({ status: 'stopped', runId: held.runId });
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        expect(yield* runsPort.latestRun(thread.id)).toMatchObject({ id: held.runId, status: 'aborted', settledBy: 'reader' });
        expect((yield* storage.aggregate.find(thread.id))?.status).toBe('idle');
        processB.plan.push(
          replyTurn({
            chunks: [
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', text: 'Again, then.' },
              { type: 'text-end', id: 't1' },
            ],
            steps: [scriptedStep({ text: 'Again, then.', messages: [Message.assistant('Again, then.')] })],
          }),
        );
        const next = yield* startedTurn(processB, thread.id, 'Again.');
        expect(next.runId).not.toBe(held.runId);
        yield* pump(next);
        expect((yield* runsPort.latestRun(thread.id))?.status).toBe('completed');
      }),
    );
    test.each([
      ['a quick', 5_000, false],
      ['a slow', 40, true],
    ] as const)(
      'a stop of a run a live owner holds answers requested at once, and the owner with %s drain writes the words it only showed once, before the end',
      Effect.fnUntraced(function* (_, takeoverAfterMs, slow) {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const rhythm = { heartbeatIntervalMs: 5, takeoverAfterMs, streamFlushIntervalMs: 60_000 };
        const processA = yield* scriptedWorld(storage, thread.agentId, { rhythm });
        const reached = gate();
        const draining = gate();
        processA.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'shown' },
              { type: 'text-delta', id: 'shown', text: 'Shown by the owner, not yet written.' },
            ],
            reached: reached.reach,
            onAbort: () => Effect.andThen(Effect.sync(draining.reach), draining.released),
          }),
        );
        const held = yield* startedTurn(processA, thread.id, 'Begin.');
        yield* reached.reached;
        const processB = yield* scriptedWorld(storage, thread.agentId, { rhythm });
        expect(yield* processB.harness.threads.handle(thread.id, OWNER).stop()).toEqual({ status: 'requested', runId: held.runId });
        yield* draining.reached;
        const runsPort = storage.runs({ ownerId: 'observer', scope: SCOPE });
        if (slow) {
          const started = yield* Clock.currentTimeMillis;
          yield* until(() =>
            Effect.map(runsPort.latestRun(thread.id), (run) => run !== null && run.heartbeatAt.getTime() >= started + takeoverAfterMs * 2),
          );
        }
        draining.release();
        yield* until(() => Effect.map(runsPort.latestRun(thread.id), (run) => run?.status !== 'running'));
        expect(yield* runsPort.latestRun(thread.id)).toMatchObject({ id: held.runId, status: 'aborted', settledBy: 'reader' });
        const events = yield* readThreadEvents(storage.eventLog, storage.kinds, thread.id, 0, 1_000);
        const said = events.filter((event) => {
          const entry = event.payload.entry as
            | {
                type?: string;
                text?: string;
              }
            | undefined;
          return entry?.type === 'message' && entry.text === 'Shown by the owner, not yet written.';
        });
        expect(said).toHaveLength(1);
        expect(events.indexOf(said[0]!)).toBeLessThan(events.findIndex((event) => event.payload.entry?.type === 'run-end'));
      }),
    );
  });
}
