import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Deferred, Effect, Exit, Scope, Stream } from 'effect';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import { HostRefused, WireLost, WireUnavailable } from '@runlith/executions/Executions';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { RecordChunk } from '../../../executions/contract/wire/viewLeases.js';
import { runEnd } from './protocolEnds.js';
import { ProtocolRig, protocolFixture, scenario, until, type Said } from './protocolRig.js';

const CLAUDE = { name: 'claude-code', hosts: 'tagma' } as const;
const unreachable = () => new WireUnavailable({ kind: 'unreachable', reason: 'the host logic is changing', sent: false });

layer(protocolFixture('protocol-continuity'), { excludeTestServices: true })('ACP host continuity', (it) => {
  it.effect('a closed subscription and unreachable host resume a split frame on the same process', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-swap-output';
      const report = join(rig.stage, 'swap-output.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          const retrying = yield* Deferred.make<void>();
          const restored = yield* Deferred.make<void>();
          yield* Effect.addFinalizer(() => Effect.asVoid(Deferred.succeed(restored, undefined)));
          let armed = false;
          let cut = false;
          let lost = false;
          const said: Said[] = [];
          const floor = yield* rig.floor(said, {
            fails: 0,
            refuses: false,
            records: (records) => ({
              bytes: records.bytes,
              records: (cursor) =>
                Stream.suspend(() => {
                  if (cut && !Deferred.isDoneUnsafe(restored))
                    return Stream.fromEffect(Effect.andThen(Deferred.succeed(retrying, undefined), Effect.fail(unreachable())));
                  return records.records(cursor).pipe(
                    Stream.flatMap((chunk): Stream.Stream<RecordChunk, WireLost> => {
                      if (!armed || chunk._tag !== 'Bytes' || chunk.bytes.length < 2 || lost) return Stream.succeed(chunk);
                      const bytes = chunk.bytes.subarray(0, Math.floor(chunk.bytes.length / 2));
                      if (cut) {
                        lost = true;
                        return Stream.concat(
                          Stream.succeed({
                            ...chunk,
                            bytes,
                            range: {
                              ...chunk.range,
                              next: ByteOffset.make(String(BigInt(chunk.range.cursor.offset) + BigInt(bytes.length))),
                            },
                          }),
                          Stream.fail(new WireLost({ reason: 'the restored connection ended mid-frame', sent: false })),
                        );
                      }
                      cut = true;
                      return Stream.fromIterable<RecordChunk>([
                        {
                          ...chunk,
                          bytes,
                          range: {
                            ...chunk.range,
                            next: ByteOffset.make(String(BigInt(chunk.range.cursor.offset) + BigInt(bytes.length))),
                          },
                        },
                        { _tag: 'Ended', ending: 'closed' },
                      ]);
                    }),
                    Stream.takeUntil((chunk) => chunk._tag === 'Ended'),
                  );
                }),
            }),
          });
          const driver = yield* floor.driver('swap-output-owner');
          yield* driver.start(threadId);
          const before = (yield* floor.sessionStore.read(threadId))!.execution!;
          armed = true;
          yield* driver.send(threadId, 'Read every byte once');
          const outcome = yield* Effect.raceFirst(
            Effect.as(Deferred.await(retrying), 'retrying'),
            Effect.as(until(runEnd(rig.world.context, threadId), 'the interrupted output ended', report, rig.changes(threadId)), 'ended'),
          );
          expect(outcome).toBe('retrying');
          yield* Deferred.succeed(restored, undefined);
          const ended = yield* until(runEnd(rig.world.context, threadId), 'read the resumed answer', report, rig.changes(threadId));
          expect(ended.status).toBe('completed');
          expect(said.filter((one) => one.threadId === threadId).map((one) => one.text)).toEqual(['echo: heard']);
          expect((yield* floor.sessionStore.read(threadId))?.execution).toEqual(before);
          expect((yield* driver.state(threadId)).driverFailure).toBeNull();
        }),
      );
    }),
  );

  it.effect('a gap ending resumes from the nonzero retained byte floor', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-retained-gap';
      const report = join(rig.stage, 'retained-gap.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          let armed = false;
          let floorAt: bigint | null = null;
          const said: Said[] = [];
          const floor = yield* rig.floor(said, {
            fails: 0,
            refuses: false,
            records: (records) => ({
              bytes: (cursor, limit, options) =>
                records.bytes(cursor, limit, options).pipe(
                  Effect.map((read) =>
                    floorAt === null
                      ? read
                      : {
                          ...read,
                          range: { ...read.range, retainedFrom: ByteOffset.make(String(floorAt)), gap: BigInt(cursor.offset) < floorAt },
                        },
                  ),
                ),
              records: (cursor) =>
                Stream.suspend(() => {
                  if (floorAt !== null && BigInt(cursor.offset) < floorAt)
                    return Stream.succeed({ _tag: 'Ended' as const, ending: 'gap' as const });
                  return records.records(cursor).pipe(
                    Stream.map((chunk): RecordChunk => {
                      if (!armed || floorAt !== null || chunk._tag !== 'Bytes' || !new TextDecoder().decode(chunk.bytes).includes('echo: '))
                        return chunk;
                      const newline = chunk.bytes.indexOf(10);
                      floorAt = BigInt(chunk.range.cursor.offset) + BigInt(newline > 1 ? Math.floor(newline / 2) : 1);
                      return { _tag: 'Ended', ending: 'gap' };
                    }),
                    Stream.takeUntil((chunk) => chunk._tag === 'Ended'),
                  );
                }),
            }),
          });
          const driver = yield* floor.driver('retained-gap-owner');
          yield* driver.start(threadId);
          armed = true;
          yield* driver.send(threadId, 'Answer through the retained tail');
          expect(
            (yield* until(runEnd(rig.world.context, threadId), 'the retained tail completed the turn', report, rig.changes(threadId)))
              .status,
          ).toBe('completed');
          expect(said.filter((one) => one.threadId === threadId).map((one) => one.text)).toEqual(['heard']);
        }),
      );
    }),
  );

  it.effect('a drive interrupted by an unreachable host is driven again without ending the session', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-drive-outage';
      const report = join(rig.stage, 'drive-outage.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          let disconnected = true;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            terminals: (terminals) => ({
              ...terminals,
              record: (...args) =>
                Effect.suspend(() => {
                  if (!disconnected) return terminals.record(...args);
                  disconnected = false;
                  return Effect.fail(unreachable());
                }),
            }),
          });
          const driver = yield* floor.driver('drive-outage-owner');
          yield* driver.start(threadId);
          expect((yield* driver.state(threadId)).driverFailure).toBeNull();
          expect((yield* floor.sessionStore.read(threadId))?.session?.state).toBe('running');
          yield* driver.send(threadId, 'Answer after the host returns');
          expect(
            (yield* until(runEnd(rig.world.context, threadId), 'the recovered drive answered', report, rig.changes(threadId))).status,
          ).toBe('completed');
        }),
      );
    }),
  );

  it.effect('an active retry keeps its heartbeat hold and restores text and tool input exactly once', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-active-drive-outage';
      const report = join(rig.stage, 'active-drive-outage.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          const lost = yield* Deferred.make<void>();
          const retrying = yield* Deferred.make<void>();
          const heartbeat = yield* Deferred.make<void>();
          let outage = false;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            runs: (runs) => ({
              ...runs,
              writeHeartbeats: (ids, at) =>
                Effect.tap(runs.writeHeartbeats(ids, at), () => (outage ? Deferred.succeed(heartbeat, undefined) : Effect.void)),
            }),
            terminals: (terminals) => ({
              ...terminals,
              record: (...args) =>
                outage ? Effect.andThen(Deferred.succeed(retrying, undefined), Effect.fail(unreachable())) : terminals.record(...args),
            }),
            records: (records) => ({
              bytes: records.bytes,
              records: (cursor) =>
                Stream.merge(
                  records.records(cursor),
                  Stream.fromEffect(Effect.as(Deferred.await(lost), { _tag: 'Ended' as const, ending: 'completed' as const })),
                ),
            }),
          });
          const driver = yield* floor.driver('active-drive-outage-owner');
          const sent = yield* driver.send(threadId, 'STREAM SCRIBBLE');
          if (sent.status !== 'started') return yield* Effect.die(`the turn answered ${sent.status}`);
          const ownership = yield* floor.harness.runs.ownership();
          const snapshot = () => floor.harness.reads.snapshot(threadId);
          yield* until(
            Effect.map(snapshot(), (state) =>
              state.live.open.some((entry) => coreEntry(entry) && entry.type === 'message' && entry.text === 'Partial') ? true : null,
            ),
            'the active text was visible',
            report,
            rig.changes(threadId),
          );
          yield* rig.files.writeFileString(`${report}.release`, '');
          yield* until(
            Effect.map(snapshot(), (state) =>
              state.live.open.some(
                (entry) =>
                  coreEntry(entry) &&
                  entry.type === 'tool' &&
                  entry.toolInputRaw?.kind === 'text' &&
                  entry.toolInputRaw.text === '{"path":"fixture.ts","offset":1}',
              )
                ? true
                : null,
            ),
            'the tool input was visible',
            report,
            rig.changes(threadId),
          );
          outage = true;
          yield* Deferred.succeed(lost, undefined);
          yield* Deferred.await(retrying);
          yield* Deferred.await(heartbeat);
          expect(ownership.launchable(sent.runId)).toBe(true);
          outage = false;
          expect(
            (yield* until(runEnd(rig.world.context, threadId), 'the recovered drive ended the lost output', report, rig.changes(threadId)))
              .status,
          ).toBe('failed');
          const transcript = (yield* snapshot()).transcript;
          expect(
            transcript.flatMap((entry) => (coreEntry(entry) && entry.type === 'message' && entry.role === 'assistant' ? [entry.text] : [])),
          ).toEqual(['Partial']);
          expect(
            transcript.flatMap((entry) =>
              coreEntry(entry) && entry.type === 'tool' && entry.toolCallId === 'written-call'
                ? [entry.toolInputRaw?.kind === 'text' ? entry.toolInputRaw.text : null]
                : [],
            ),
          ).toEqual(['{"path":"fixture.ts","offset":1}']);
        }),
      );
    }),
  );

  it.effect('definitive output loss ends the process even when its first stop never reached the host', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-lost-output';
      const report = join(rig.stage, 'lost-output.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          const lost = yield* Deferred.make<void>();
          let absent = true;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            hostStop:
              (stop) =>
              (...args) =>
                Effect.suspend(() => {
                  if (!absent) return stop(...args);
                  absent = false;
                  return Effect.fail(unreachable());
                }),
            records: (records) => ({
              bytes: records.bytes,
              records: (cursor) =>
                Stream.merge(
                  records.records(cursor),
                  Stream.fromEffect(Effect.as(Deferred.await(lost), { _tag: 'Ended' as const, ending: 'unavailable' as const })),
                ),
            }),
          });
          const driver = yield* floor.driver('lost-output-owner');
          yield* driver.start(threadId);
          const before = (yield* floor.sessionStore.read(threadId))!.execution!;
          const record = (yield* floor.terminals.record(before.execution, before.incarnation))!;
          yield* driver.send(threadId, 'HOLD the turn');
          yield* Deferred.succeed(lost, undefined);
          expect(
            (yield* until(runEnd(rig.world.context, threadId), 'the output loss ended the turn', report, rig.changes(threadId))).status,
          ).toBe('failed');
          expect((yield* floor.terminals.state(record.execution))?.state.phase).toBe('ended');
          expect((yield* driver.state(threadId)).driverFailure).toBeNull();
        }),
      );
    }),
  );

  it.effect('restart retires a drive still waiting for the answer to an earlier stop', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-restart-blocked-stop';
      const report = join(rig.stage, 'restart-blocked-stop.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          const lost = yield* Deferred.make<void>();
          const entered = yield* Deferred.make<void>();
          let waiting = true;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
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
                  Stream.fromEffect(Effect.as(Deferred.await(lost), { _tag: 'Ended' as const, ending: 'unavailable' as const })),
                ),
            }),
          });
          const driver = yield* floor.driver('restart-blocked-stop-owner');
          yield* driver.start(threadId);
          const before = (yield* floor.sessionStore.read(threadId))!.execution!;
          const record = (yield* floor.terminals.record(before.execution, before.incarnation))!;
          yield* Deferred.succeed(lost, undefined);
          yield* Deferred.await(entered);
          expect((yield* driver.restart(threadId)).runId).toBeNull();
          expect((yield* floor.terminals.state(record.execution))?.state.phase).toBe('ended');
          expect((yield* floor.sessionStore.read(threadId))?.session?.state).toBe('ended');
        }),
      );
    }),
  );

  it.effect('restart closes a same-generation gone runner without issuing a stop for it', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-restart-gone';
      const report = join(rig.stage, 'restart-gone.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          let gone = false;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            terminals: (terminals) => ({ ...terminals, state: (ref) => (gone ? Effect.succeed(undefined) : terminals.state(ref)) }),
            hostStop:
              (stop) =>
              (...args) =>
                gone
                  ? Effect.fail(new HostRefused({ refusal: { _tag: 'UnknownExecution', reason: 'the execution is gone' } }))
                  : stop(...args),
          });
          const scope = yield* Scope.fork(yield* Effect.scope);
          const before = yield* floor.driver('restart-gone-before').pipe(Scope.provide(scope));
          yield* before.start(threadId);
          const execution = (yield* floor.sessionStore.read(threadId))!.execution!;
          const record = (yield* floor.terminals.record(execution.execution, execution.incarnation))!;
          yield* Scope.close(scope, Exit.void);
          yield* floor.terminals.stop(
            record.projectId,
            {
              projectId: record.projectId,
              operationId: HostRequestKey.make('gone-before-restart'),
              requester: record.holder,
              mutation: 'stop',
              targetKey: record.targetKey,
              execution: record.execution,
            },
            record.execution,
            record.revision,
            'explicit-stop',
            'signal',
          );
          gone = true;
          const driver = yield* floor.driver('restart-gone-after');
          expect((yield* driver.restart(threadId)).runId).toBeNull();
          expect((yield* floor.sessionStore.read(threadId))?.session?.state).toBe('ended');
          gone = false;
          yield* driver.send(threadId, 'Answer after the missing runner');
          expect(
            (yield* until(runEnd(rig.world.context, threadId), 'the replacement runner answered', report, rig.changes(threadId))).status,
          ).toBe('completed');
        }),
      );
    }),
  );

  it.effect('restart replaces a dead drive after its earlier stop is proven unsent', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-restart-spent-stop';
      const report = join(rig.stage, 'restart-spent-stop.report');
      yield* rig.agentBinary(report, 'tagma', 'claude-code');
      yield* rig.openThread(threadId, CLAUDE);
      yield* scenario(
        Effect.gen(function* () {
          let absent = true;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            hostStop:
              (stop) =>
              (...args) =>
                absent ? Effect.fail(new WireLost({ reason: 'the stop answer was lost', sent: true })) : stop(...args),
          });
          const scope = yield* Scope.fork(yield* Effect.scope);
          const beforeDriver = yield* floor.driver('restart-spent-stop-owner').pipe(Scope.provide(scope));
          yield* beforeDriver.start(threadId);
          const before = (yield* floor.sessionStore.read(threadId))!;
          const execution = before.execution!;
          const record = (yield* floor.terminals.record(execution.execution, execution.incarnation))!;
          const operationId = HostRequestKey.make(`harness-stop:${before.session!.id}:${execution.execution}:${execution.incarnation}`);
          const failed = yield* Effect.result(
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
          expect(failed._tag).toBe('Failure');
          expect((yield* floor.terminals.request(record.projectId, operationId))._tag).toBe('Settled');
          absent = false;
          yield* Scope.close(scope, Exit.void);
          const row = (yield* floor.rows.load(threadId))!;
          yield* floor.units.write(floor.rows.writes, (unit) =>
            floor.rows.write(unit, threadId, { ...row, failure: 'the output record is unavailable' }),
          );
          yield* floor.sessionStore.change(threadId, (facet) =>
            Effect.succeed({
              facet: { ...facet, session: { ...facet.session!, state: 'uncertain' as const, ownerId: null } },
              value: undefined,
            }),
          );
          const driver = yield* floor.driver('restart-spent-stop-recovery');
          expect((yield* floor.terminals.state(record.execution))?.state.phase).toBe('running');
          const restarted = yield* driver.restart(threadId);
          expect(restarted.runId).toBeNull();
          expect((yield* floor.terminals.state(record.execution))?.state.phase).toBe('ended');
          yield* driver.send(threadId, 'Answer after restart');
          expect(
            (yield* until(runEnd(rig.world.context, threadId), 'the new process answered', report, rig.changes(threadId))).status,
          ).toBe('completed');
          expect((yield* floor.sessionStore.read(threadId))?.execution?.execution).not.toBe(execution.execution);
        }),
      );
    }),
  );
});
