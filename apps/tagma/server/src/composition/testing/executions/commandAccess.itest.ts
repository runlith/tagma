import { callerInThread } from '../callers';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { checkoutPaths, fixedCoverage } from '../../../workspace/testing/doubles.js';
import { Clock, Effect, FileSystem, Layer, Schema, Stream } from 'effect';
import { removeRule, writeRule } from '../../../executions/testing/doubles.js';
import { commandTimes } from '../../../threads/testing/doubles.js';
import { currentRules } from '../../../executions/store/standingRules.js';
import { WireUnavailable } from '@runlith/executions/Executions';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions } from '@runlith/executions/Executions';
import type { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { ExecutionId, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CommandSnapshot } from '@runlith/executions/protocol/command';
import { NamespaceId } from '@runlith/files/namespace';
import { sql } from 'drizzle-orm';
import { demoGraphLayer, withDemo, type EffectDemo } from '../graphFixture.js';
import { threadRunStore, type ThreadStore } from '../../../native-harness/testing/doubles.js';
import { threadStack, type ThreadParts } from '../threadParts.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { SessionIdentity } from '../../../platform/contract/wire/session.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { EnvironmentId } from '../../../workspace/contract/wire/environments.js';
import { TargetKey, type ResolvedExecutionTarget } from '../../../executions/contract/wire/targets.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import type { CommandRecord } from '../../../executions/contract/wire/commands.js';
import { shelveRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import type { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import type { CommandAccess, CommandAccessRequest } from '../../../executions/contract/service/access.js';
import { commandAdmission } from '../../../executions/testing/doubles.js';
import { terminalThreads } from '../../../executions/testing/doubles.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { storesOver, type Stores } from '../../../executions/testing/stores.js';
import { ENTRY_KINDS } from '../../manifest.js';

const fixture = demoGraphLayer({ projects: ['other'] }).pipe(Layer.provideMerge(BunFileSystem.layer));
const makeAccess = Effect.fnUntraced(function* (demo: EffectDemo) {
  const files = yield* FileSystem.FileSystem;
  const otherRoot = yield* files.realPath(demo.project('other').root);
  const homeRoot = yield* files.realPath(demo.demoRoot);
  const elsewhere = (projectId: number) => {
    const home = fixedCoverage(demo.projectId, [{ checkout: 'home', root: homeRoot }]);
    const other = fixedCoverage(projectId, [{ checkout: 'other', root: otherRoot }]);
    return checkoutPaths({ ...home, covered: (id) => (id === projectId ? other : home).covered(id) }, demo.graph.projects);
  };
  const installation = InstallationId.make('command-access');
  const ref = { installation, execution: ExecutionId.make('child-command'), incarnation: 0 };
  const unavailable = () =>
    Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'Unused host operation in authority test.', sent: false }));
  const host: Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'] = {
    status: unavailable,
    capabilities: unavailable,
    generation: unavailable,
    served: unavailable,
    list: unavailable,
    changes: unavailable,
    state: unavailable,
    ending: unavailable,
    retained: unavailable,
    command: () => Effect.succeed(snapshot),
    revise: unavailable,
    commands: unavailable,
    commandsAt: unavailable,
    operation: unavailable,
    callResult: unavailable,
    start: unavailable,
    cancelStart: unavailable,
    read: unavailable,
    subscribe: () => Stream.fromEffect(unavailable()),
    screen: unavailable,
    point: unavailable,
    input: unavailable,
    signal: unavailable,
    stop: unavailable,
    retire: unavailable,
    processes: unavailable,
    foreground: unavailable,
    listeners: unavailable,
    hostListeners: unavailable,
    custody: unavailable,
    take: unavailable,
    fence: unavailable,
    release: unavailable,
    grant: unavailable,
    openBinding: unavailable,
    closeBinding: unavailable,
    quiesce: unavailable,
    resume: unavailable,
    prepare: unavailable,
    yield: unavailable,
    shutdown: unavailable,
    pace: unavailable,
    disown: unavailable,
    endResidual: unavailable,
    endProcess: unavailable,
    load: unavailable,
  };
  const actor = (threadId: ThreadId): TerminalActor => ({ _tag: 'Thread', threadId, projectId: demo.projectId });
  const operator: TerminalActor = { _tag: 'Operator' };
  const born = (from?: ThreadId) =>
    demo.graph.units.write('CommandAccess.born', (unit) =>
      Effect.gen(function* () {
        const row =
          from === undefined
            ? yield* kernel.insert({ ownerId: 'operator', agentId: 'tagma' }, unit)
            : yield* kernel.insertChild(from, { ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId }, unit);
        return ThreadId.make(row.id);
      }),
    );

  const db = demo.graph.store.db;
  const machine = demo.graph.store;
  const records = yield* makeThreadRecords;
  const { store: kernel, threads } = yield* threadStack({ db, units: demo.graph.units, records, kinds: ENTRY_KINDS });
  const store = storesOver(db, installation);
  const access = yield* Effect.gen(function* () {
    const paths = yield* elsewhere(demo.project('other').id);
    return yield* commandAdmission({
      commandRows: store.commandRows,
      register: terminalThreads({ db }),
      executions: host,
      rules: (projectId, thread, home) =>
        Effect.map(currentRules(machine, projectId, thread, home), (standing) => standing.map((one) => one.rule)),
    }).pipe(
      Effect.provideServiceEffect(ThreadLineage, lineageOver(machine, demo.graph.units)),
      Effect.provideService(CheckoutPaths, paths),
      Effect.provideService(SessionIdentity, testSessionIdentity),
      Effect.provideService(MachineUnits, demo.graph.units),
    );
  });
  const parent = yield* born();
  const child = yield* born(parent);
  const unrelated = yield* born();
  const record: CommandRecord = {
    projectId: demo.projectId,
    execution: ref,
    owner: { _tag: 'Thread', thread: child },
    origin: { _tag: 'Thread', thread: child, run: 'origin-run', toolCall: 'origin-call' },
    policyIdentity: 'admitted-policy',
    targetKey: TargetKey.make('exact-target'),
    holdings: {},
    admittedAt: 1,
  };
  yield* demo.graph.units.write('CommandAccess', (unit) => store.commandRows.projectCommand(unit, record));
  const snapshot: CommandSnapshot = {
    admission: {
      origin: { scope: 'project', owner: child, cohort: parent },
      limits: { executionMs: 40, executionCeilingMs: 100, origin: 'rule' },
      policyIdentity: 'admitted-policy',
    },
    state: {
      ref,
      transport: 'pipes',
      lifetime: 'command',
      purpose: 'command',
      phase: 'running',
      streams: { stdout: 'open', stderr: 'open', pty: 'eof' },
      cleanup: 'pending',
      record: 'available',
    },
    deadline: { execution: ref, revision: 2, executionMs: 40, ceilingMs: 100, origin: 'caller', armed: 'native-acquired' },
  };

  const refusal = Effect.fnUntraced(function* (request: CommandAccessRequest) {
    const result = yield* Effect.result(access.prepare(request));
    expect(result._tag).toBe('Failure');
    return result._tag === 'Failure' && result.failure._tag === 'TerminalRefused' ? result.failure.reason : null;
  });
  const stop = (who: TerminalActor): Extract<CommandAccessRequest, { _tag: 'Stop' }> => ({
    _tag: 'Stop',
    actor: who,
    scope: demo.projectId,
    execution: ref,
  });
  const revise = (who: TerminalActor, executionMs: number): Extract<CommandAccessRequest, { _tag: 'Revise' }> => ({
    _tag: 'Revise',
    actor: who,
    scope: demo.projectId,
    execution: ref,
    change: { _tag: 'Total', executionMs },
  });
  const remaining = (who: TerminalActor): Extract<CommandAccessRequest, { _tag: 'Revise' }> => ({
    _tag: 'Revise',
    actor: who,
    scope: demo.projectId,
    execution: ref,
    change: { _tag: 'Remaining', remainingMs: 10 },
  });

  const target = (): ResolvedExecutionTarget => {
    const namespaceId = NamespaceId.make('fixture');
    const witness = { provider: 'test', format: 'test', token: 'ground' };
    return {
      projectId: demo.projectId,
      binding: { environmentId: EnvironmentId.make('host'), kind: 'host', namespaceId, identityWitness: witness },
      footprint: { status: 'complete', resource: { namespaceId, path: '/work' }, witness, registryRevision: 0, roots: [] },
    };
  };
  const launch = (who: TerminalActor): Extract<CommandAccessRequest, { _tag: 'Launch' }> => ({
    _tag: 'Launch',
    actor: who,
    scope: demo.projectId,
    target: target(),
    program: 'echo',
    args: ['hello'],
    tool: 'bash',
    owner: who._tag === 'Thread' ? { _tag: 'Thread', thread: who.threadId } : { _tag: 'Operator' },
    creator: who._tag === 'Thread' ? { _tag: 'Thread', thread: who.threadId } : { _tag: 'Operator' },
    operation: HostRequestKey.make('launch'),
  });
  return {
    demo,
    otherRoot,
    access,
    store,
    records,
    kernel,
    parent,
    child,
    unrelated,
    record,
    ref,
    actor,
    operator,
    born,
    refusal,
    stop,
    revise,
    remaining,
    launch,
  };
});

const scenario = <A, E, R>(body: (world: Effect.Success<ReturnType<typeof makeAccess>>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => Effect.flatMap(makeAccess(demo), body));

layer(fixture, { excludeTestServices: true })('command access', (it) => {
  it.effect('a thread moves its own or a descendant command either way within its ceiling, and anyone passes it by exception', () =>
    scenario(({ access, revise, actor, child, remaining, parent, refusal, operator }) =>
      Effect.gen(function* () {
        expect((yield* access.prepare(revise(actor(child), 30))).revision).toBe(2);
        expect((yield* access.prepare(revise(actor(child), 60))).revision).toBe(2);
        expect((yield* access.prepare(remaining(actor(child)))).revision).toBe(2);
        expect((yield* access.prepare(revise(actor(parent), 60))).revision).toBe(2);
        expect(yield* refusal(revise(actor(child), 101))).toBe('ceiling');
        expect((yield* access.prepare({ ...revise(actor(parent), 101), exceptionMs: 101 })).revision).toBe(2);
        expect((yield* access.prepare(remaining(operator))).revision).toBe(2);
        expect((yield* access.prepare(revise(operator, 100))).revision).toBe(2);
        expect(yield* refusal(revise(operator, 101))).toBe('ceiling');
        const exceptional = yield* access.prepare({ ...revise(operator, 101), exceptionMs: 101 });
        expect(exceptional.subjects.some((subject) => subject.value.startsWith('command:exception:'))).toBe(true);
      }),
    ),
  );

  it.effect('service-owned work launches under the operator’s authority alone, and ownership named by the operator is genuine', () =>
    scenario(({ access, launch, operator, actor, child, refusal }) =>
      Effect.gen(function* () {
        expect((yield* access.prepare(launch(operator))).owner).toEqual({ _tag: 'Operator' });
        const request = launch(actor(child));
        const scope = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)('nightly');
        expect(yield* refusal({ ...request, owner: { _tag: 'Service', scope } })).toBe('service-denied');
        expect((yield* access.prepare({ ...request, actor: operator, owner: { _tag: 'Thread', thread: child } })).owner).toEqual({
          _tag: 'Thread',
          thread: child,
        });
        expect((yield* access.prepare({ ...launch(operator), owner: { _tag: 'Service', scope } })).owner).toEqual({
          _tag: 'Service',
          scope,
        });
      }),
    ),
  );

  it.effect(
    'a launch is admitted under its life whatever its wait: the default where it names none, its own ask up to the life ceiling',
    () =>
      scenario(({ access, launch, actor, child }) =>
        Effect.gen(function* () {
          const request = launch(actor(child));
          expect((yield* access.prepare(request)).receipt?.limits).toEqual({
            executionMs: 3_600_000,
            executionCeilingMs: 21_600_000,
            origin: 'default',
          });
          const held = (yield* access.prepare({ ...request, requested: 1_600_000, waitMs: 180_000 })).receipt;
          expect(held?.limits).toEqual({ executionMs: 1_600_000, executionCeilingMs: 21_600_000, origin: 'caller' });
          expect(held?.time).toMatchObject({ life: { ms: 1_600_000, origin: 'caller' }, waitMs: 180_000 });
        }),
      ),
  );

  it.effect('a launch whose cwd stands in another project lives by that project’s rules, and one at home by its own', () =>
    scenario(({ demo, access, launch, actor, child, otherRoot }) =>
      Effect.gen(function* () {
        const request = launch(actor(child));
        const machine = demo.graph.store;
        const written = yield* writeRule(machine, {
          projectId: demo.project('other').id,
          thread: null,
          through: null,
          program: null,
          measure: 'life',
          limitMs: 120_000,
          writer: 'operator',
          words: 'two minutes in the other project',
          position: { at: 'end' },
        });
        yield* Effect.gen(function* () {
          expect((yield* access.prepare({ ...request, cwd: `${otherRoot}/src` })).receipt?.limits).toEqual({
            executionMs: 120_000,
            executionCeilingMs: 120_000,
            origin: 'rule',
          });
          const files = yield* FileSystem.FileSystem;
          const link = join(demo.demoRoot, 'other-link');
          yield* files.symlink(otherRoot, link);
          const prepared = yield* access.prepare({ ...request, cwd: link });
          expect(prepared.receipt?.limits).toEqual({
            executionMs: 120_000,
            executionCeilingMs: 120_000,
            origin: 'rule',
          });
          expect(prepared.request._tag === 'Launch' && prepared.request.cwd).toBe(otherRoot);
          yield* files.remove(link);
          yield* files.symlink(demo.demoRoot, link);
          yield* demo.graph.units.read((unit) => access.recheck(unit, prepared));
          expect(prepared.request._tag === 'Launch' && prepared.request.cwd).toBe(otherRoot);
          expect((yield* access.prepare({ ...request, cwd: demo.demoRoot })).receipt?.limits).toMatchObject({
            executionMs: 3_600_000,
            origin: 'default',
          });
          const privateTree = yield* files.realPath(yield* demo.fixture.directory('commit-tree'));
          const step = yield* access.prepare({ ...request, tool: 'commit-step', cwd: privateTree, policyRoot: otherRoot });
          expect(step.receipt?.limits).toEqual({ executionMs: 120_000, executionCeilingMs: 120_000, origin: 'rule' });
          expect(step.request).toMatchObject({
            scope: demo.projectId,
            cwd: privateTree,
            ruled: { projectId: demo.project('other').id, root: otherRoot, cwd: privateTree },
          });
          yield* demo.graph.units.read((unit) => access.recheck(unit, step));
          expect(step.request._tag === 'Launch' && step.request.cwd).toBe(privateTree);
        }).pipe(Effect.ensuring(Effect.orDie(removeRule(machine, written.rule.id))));
      }),
    ),
  );

  it.effect('a launch attributes its creator thread and never a stranger', () =>
    scenario(({ access, launch, actor, child, unrelated, operator, refusal }) =>
      Effect.gen(function* () {
        const own = launch(actor(child));
        expect(yield* refusal({ ...own, creator: { _tag: 'Thread', thread: unrelated } })).toBe('ineligible');
        expect(yield* refusal({ ...own, creator: { _tag: 'Operator' } })).toBe('ineligible');
        const op = launch(operator);
        expect(yield* refusal({ ...op, creator: { _tag: 'Thread', thread: ThreadId.make('thread-nowhere') } })).toBe('no-owner');
        expect((yield* access.prepare({ ...op, creator: { _tag: 'Thread', thread: child } })).request._tag).toBe('Launch');
      }),
    ),
  );

  it.effect('full execution and project identities refuse substitution', () =>
    scenario(({ demo, ref, refusal, stop, operator, actor, child, launch }) =>
      Effect.gen(function* () {
        expect(yield* refusal({ ...stop(operator), execution: { ...ref, incarnation: 1 } })).toBe('stale-authority');
        expect(yield* refusal({ ...stop(actor(child)), scope: demo.projectId + 1 })).toBe('foreign-project');
        const request = launch(operator);
        expect(yield* refusal({ ...request, target: { ...request.target, projectId: demo.projectId + 1 } })).toBe('foreign-project');
      }),
    ),
  );

  it.effect('reading and awaiting keep their authority when an ended command releases its checkout', () =>
    scenario(({ demo, ref, access, actor, child }) =>
      Effect.gen(function* () {
        const db = demo.graph.store.db;
        yield* db.run(sql`insert into file_root_namespace (namespace_id, revision) values ('authority-root', 0)`);
        yield* db.run(sql`insert into root_use (use_id, namespace_id, path, consumer_kind, consumer_id, mode, state)
    values ('authority-use', 'authority-root', '/work', 'command', ${ref.execution}, 'shared', 'released')`);
        yield* Effect.gen(function* () {
          yield* db.run(sql`update command set root_use_id = 'authority-use' where execution_id = ${ref.execution}`);
          const observing = yield* access.prepare({ _tag: 'Observe', actor: actor(child), scope: demo.projectId, execution: ref });
          const awaiting = yield* access.prepare({ _tag: 'Await', actor: actor(child), scope: demo.projectId, execution: ref });
          yield* db.run(sql`update command set root_use_id = null where execution_id = ${ref.execution}`);
          yield* db.run(sql`delete from root_use where use_id = 'authority-use'`);
          for (const prepared of [observing, awaiting]) {
            const answer = yield* Effect.result(demo.graph.units.read((unit) => access.recheck(unit, prepared)));
            expect(answer._tag).toBe('Success');
            const fresh = yield* access.prepare(prepared.request);
            expect(fresh.subjects).toEqual(prepared.subjects);
          }
        }).pipe(
          Effect.ensuring(
            Effect.orDie(
              Effect.all([
                db.run(sql`update command set root_use_id = null where execution_id = ${ref.execution}`),
                db.run(sql`delete from root_use where use_id = 'authority-use'`),
                db.run(sql`delete from file_root_namespace where namespace_id = 'authority-root'`),
              ]),
            ),
          ),
        );
      }),
    ),
  );

  it.effect('admission rechecks live ancestry and current configuration', () =>
    scenario(({ demo, access, stop, actor, parent, launch, child }) =>
      Effect.gen(function* () {
        const prepared = yield* access.prepare(stop(actor(parent)));
        yield* shelveRecord(demo.graph.store.db, parent, { archivedAt: new Date(yield* Clock.currentTimeMillis) });
        const changed = yield* Effect.result(demo.graph.units.write('CommandAccess.changed', (unit) => access.recheck(unit, prepared)));
        expect(changed._tag === 'Failure' && changed.failure._tag === 'TerminalRefused' ? changed.failure.reason : null).toBe(
          'stale-authority',
        );
        yield* shelveRecord(demo.graph.store.db, parent, { archivedAt: null });
        const ready = yield* access.prepare(launch(actor(child)));
        const rule = yield* writeRule(demo.graph.store, {
          projectId: demo.projectId,
          thread: null,
          through: null,
          program: null,
          measure: 'life',
          limitMs: 80_000,
          writer: 'operator',
          words: 'eighty seconds',
          position: { at: 'end' },
        });
        const policy = yield* Effect.result(demo.graph.units.write('CommandAccess.policy', (unit) => access.recheck(unit, ready)));
        expect(policy._tag === 'Failure' && policy.failure._tag === 'TerminalRefused' ? policy.failure.reason : null).toBe(
          'stale-authority',
        );
        yield* removeRule(demo.graph.store, rule.rule.id);
      }),
    ),
  );

  it.effect('a put-away thread takes no new command, and a run starting in it brings it back to own one', () =>
    scenario(({ demo, born, refusal, launch, actor, kernel, records, access }) =>
      Effect.gen(function* () {
        const shelved = yield* born();
        yield* shelveRecord(demo.graph.store.db, shelved, { archivedAt: new Date(yield* Clock.currentTimeMillis) });
        expect(yield* refusal(launch(actor(shelved)))).toBe('no-owner');
        const row = yield* kernel.metadata(shelved);
        if (row === undefined) return yield* Effect.die('The thread could not be read.');
        const runs = yield* threadRunStore({ kinds: ENTRY_KINDS, records, ownerId: 'operator', scope: sql`1 = 1` });
        yield* runs.createRun({
          startFrom: row,
          kind: 'turn',
          approval: { mode: row.authority.mode, interactive: false },
          progress: { stage: 'starting', message: 'woken' },
        });
        expect((yield* access.prepare(launch(actor(shelved)))).owner).toEqual({ _tag: 'Thread', thread: shelved });
      }),
    ),
  );

  it.effect('creation attribution cannot be overwritten and indexed ownership remains distinct', () =>
    scenario(({ demo, ref, store, record, parent, child }) =>
      Effect.gen(function* () {
        const changed = yield* Effect.result(
          demo.graph.units.write('CommandAccess.changed', (unit) =>
            store.commandRows.projectCommand(unit, { ...record, origin: { _tag: 'Operator' } }),
          ),
        );
        expect(changed._tag).toBe('Failure');
        expect((yield* demo.graph.units.read((unit) => store.commandRows.recordCommand(unit, ref.execution)))?.origin).toEqual(
          record.origin,
        );
        expect((yield* demo.graph.units.read((unit) => store.commandRows.commandsHeldBy(unit, parent))).length).toBe(0);
        expect((yield* demo.graph.units.read((unit) => store.commandRows.commandsHeldBy(unit, child))).map((row) => row.execution)).toEqual(
          [ref],
        );
      }),
    ),
  );

  it.effect("a thread's tool times read its own rules of each measure again on every call, and a machine wait holds every thread", () =>
    scenario(({ demo, parent, unrelated }) =>
      Effect.gen(function* () {
        const machine = demo.graph.store;
        const rule = (projectId: number | null, thread: string | null, measure: 'wait' | 'life', limitMs: number, words: string) =>
          writeRule(machine, {
            projectId,
            thread,
            through: null,
            program: null,
            measure,
            limitMs,
            writer: 'operator',
            words,
            position: { at: 'end' },
          });
        const life = yield* rule(demo.projectId, parent, 'life', 300_000, 'five minutes to live');
        yield* Effect.gen(function* () {
          const times = commandTimes(machine, demo.projectId, () => Effect.succeed(demo.projectId));
          const own = (ask: { readonly waitMs?: number; readonly lifeMs?: number }) =>
            times.resolve(ask, callerInThread(parent, 'run-own'), '/');
          const other = (ask: { readonly waitMs?: number; readonly lifeMs?: number }) =>
            times.resolve(ask, callerInThread(unrelated, 'run-other'), '/');
          expect((yield* own({ lifeMs: 600_000 })).life).toMatchObject({ ms: 300_000, origin: 'rule' });
          expect((yield* own({ lifeMs: 60_000 })).life).toMatchObject({ ms: 60_000, origin: 'caller' });
          expect(yield* other({})).toEqual({
            wait: { ms: 120_000, origin: 'default', rule: null },
            life: { ms: 3_600_000, origin: 'default', rule: null },
          });
          const everywhere = yield* rule(null, null, 'wait', 30_000, 'wait 30 seconds for all projects');
          yield* Effect.gen(function* () {
            expect((yield* other({ waitMs: 120_000 })).wait).toMatchObject({ ms: 30_000, origin: 'rule' });
            expect((yield* own({})).wait.rule).toContain(everywhere.rule.id);
          }).pipe(Effect.ensuring(Effect.orDie(removeRule(machine, everywhere.rule.id))));
        }).pipe(Effect.ensuring(Effect.orDie(removeRule(machine, life.rule.id))));
      }),
    ),
  );
});
