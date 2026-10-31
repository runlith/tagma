import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { Executions } from '@runlith/executions/Executions';
import { ProtocolRig, protocolFixture, scenario } from './protocolRig.js';

const CLAUDE = { name: 'claude-code', hosts: 'tagma' } as const;

layer(protocolFixture('protocol-recovery'), { excludeTestServices: true })('ACP abandoned stop recovery', (it) => {
  it.effect('a registered stop whose dispatch died resolves from the host without stopping its live runner', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-orphaned-pending-stop';
      const report = join(rig.stage, 'orphaned-pending-stop.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<ReturnType<Executions['Service']['stop']>>();
          let waiting = true;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            hostStop:
              (stop) =>
              (...args) =>
                Effect.suspend(() => (waiting ? Effect.andThen(Deferred.succeed(entered, stop(...args)), Effect.never) : stop(...args))),
          });
          const driver = yield* floor.driver('orphaned-pending-owner');
          yield* driver.start(threadId);
          yield* Effect.addFinalizer(() => driver.resource.release(threadId, 'cleanup-orphaned-pending').pipe(Effect.asVoid, Effect.orDie));
          const facet = (yield* floor.sessionStore.read(threadId))!;
          const ref = facet.execution!;
          const record = (yield* floor.terminals.record(ref.execution, ref.incarnation))!;
          const operationId = HostRequestKey.make(`harness-stop:${facet.session!.id}:${ref.execution}:${ref.incarnation}`);
          const dispatch = yield* Effect.forkScoped(
            floor.terminals.stop(
              record.projectId,
              {
                projectId: record.projectId,
                operationId,
                requester: record.holder,
                mutation: 'stop',
                targetKey: record.targetKey,
                execution: record.execution,
              },
              record.execution,
              record.revision,
              'explicit-stop',
              'signal',
            ),
          );
          const delayed = yield* Deferred.await(entered);
          expect((yield* floor.terminals.request(record.projectId, operationId))._tag).toBe('Pending');
          waiting = false;
          yield* Fiber.interrupt(dispatch);
          const resolved = yield* floor.terminals.request(record.projectId, operationId);
          expect(resolved._tag).toBe('Settled');
          if (resolved._tag === 'Settled') expect(resolved.stop).toBeUndefined();
          const late = yield* Effect.result(delayed);
          expect(late._tag).toBe('Failure');
          expect((yield* floor.terminals.state(record.execution))?.state.phase).toBe('running');
        }),
      );
    }),
  );

  it.effect('restart reaches replacement while an unsent run is queued behind a pending halt', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-restart-queued-halt';
      const report = join(rig.stage, 'restart-queued-halt.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const heartbeat = yield* Deferred.make<void>();
          const lost = yield* Deferred.make<void>();
          let waiting = true;
          let queued: string | null = null;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            runs: (runs) => ({
              ...runs,
              writeHeartbeats: (ids, at) =>
                Effect.tap(runs.writeHeartbeats(ids, at), () =>
                  queued !== null && ids.includes(queued) ? Deferred.succeed(heartbeat, undefined) : Effect.void,
                ),
            }),
            hostStop:
              (stop) =>
              (...args) =>
                Effect.suspend(() => {
                  if (!waiting) return stop(...args);
                  waiting = false;
                  return Effect.andThen(Deferred.succeed(entered, undefined), Effect.never);
                }),
            records: (records) => ({
              bytes: records.bytes,
              records: (cursor) =>
                Stream.merge(
                  records.records(cursor),
                  Stream.fromEffect(
                    Effect.as(Deferred.await(lost), {
                      _tag: 'Ended' as const,
                      ending: 'unavailable' as const,
                    }),
                  ),
                ),
            }),
          });
          const driver = yield* floor.driver('restart-queued-halt-owner');
          yield* driver.start(threadId);
          yield* Effect.addFinalizer(() => driver.resource.release(threadId, 'cleanup-queued-halt').pipe(Effect.asVoid, Effect.orDie));
          const ref = (yield* floor.sessionStore.read(threadId))!.execution!;
          const record = (yield* floor.terminals.record(ref.execution, ref.incarnation))!;
          yield* Deferred.succeed(lost, undefined);
          yield* Deferred.await(entered);
          const sent = yield* driver.send(threadId, 'HOLD the queued turn');
          if (sent.status !== 'started') return yield* Effect.die(`the run answered ${sent.status}`);
          queued = sent.runId;
          yield* Deferred.await(heartbeat);
          expect(yield* driver.current(threadId)).toBeNull();
          const restarted = yield* driver.restart(threadId);
          expect(restarted.stoppedRunId).toBe(sent.runId);
          expect((yield* floor.terminals.state(record.execution))?.state.phase).toBe('ended');
          expect((yield* floor.sessionStore.read(threadId))?.execution?.execution).not.toBe(ref.execution);
        }),
      );
    }),
  );
});
