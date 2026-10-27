import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as BunPath from '@effect/platform-bun/BunPath';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress } from '@runlith/executions/hostAddress';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { Clock, Context, Data, Effect, Fiber, FileSystem, Layer, Predicate, Ref, Schedule } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { SessionIdentity } from '../../../platform/contract/wire/session.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { project } from '../../../projects/testing/doubles.js';
import { guardedFloor } from '../../../executions/testing/guardedFloor.js';
import { currentRules } from '../../../executions/store/standingRules.js';
import {
  commandAdmission,
  executionHost,
  executionPolicy,
  removeRule,
  programRoad,
  storedCommands,
  terminalHostCustody,
  terminalThreads,
  writeRule,
} from '../../../executions/testing/doubles.js';
import { shippedChain } from '../../../platform/store/chain.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { fixtureMigrations } from '../migrations.js';
import { hostFixtureLayer, makeHostCase, HOST_LIBRARY as LIBRARY } from './fixture.js';

const INSTALLATION = InstallationId.make('program-road');
const thread = ThreadId.make('program-thread');

class ProcessUnmeasured extends Data.TaggedError('ProcessUnmeasured')<{ readonly pid: number; readonly cause: unknown }> {
  override get message() {
    return `Cannot inspect fixture process ${this.pid}: ${String(this.cause)}`;
  }
}

const makeFixture = Effect.gen(function* () {
  const raised = yield* makeHostCase({ name: 'program', installation: INSTALLATION, threads: [thread] });
  const connection = yield* executionHost(yield* hostAddress(raised.canonical, 'program-road'));
  const port = connection.port;
  const store = Context.get(raised.context, MachineStore);
  const units = Context.get(raised.context, MachineUnits);
  const custody = yield* terminalHostCustody({
    executions: port,
    welcome: connection.welcome,
    installation: INSTALLATION,
    state: raised.canonical,
    offered: {
      bundle: raised.bundle.root,
      digest: raised.bundle.manifest.identity.digest,
      database: store.schema,
      application: shippedChain(fixtureMigrations),
      policy: executionPolicy(),
      lifetime: 'with-parent',
    },
  });
  yield* Ref.set(connection.opened, custody.opened);
  const context = Context.add(raised.context, SessionIdentity, sessionIdentity);
  const floor = yield* guardedFloor({ port, guarded: custody.guarded(), db: store.db, installation: INSTALLATION }).pipe(
    Effect.provide(context),
  );
  const access = yield* commandAdmission({
    commandRows: floor.stores.commandRows,
    register: terminalThreads({ db: store.db }),
    executions: custody.guarded(),
    rules: (project, owner, home) => Effect.map(currentRules(store, project, owner, home), (standing) => standing.map((one) => one.rule)),
  }).pipe(Effect.provideServiceEffect(ThreadLineage, lineageOver(store, units)), Effect.provide(context));
  const reader = yield* storedCommands({ commandRows: floor.stores.commandRows, requestKeys: floor.stores.requestKeys, host: port }).pipe(
    Effect.provide(context),
  );
  const road = programRoad(floor.terminals, floor.terminals.commands, access, floor.targets, '/bin/sh');
  return { ...raised, store, reader, thread, road };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/ProgramFixture') {}
const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const fixture = Layer.effect(Fixture, makeFixture).pipe(
  Layer.provide(hostFixtureLayer('program-road')),
  Layer.provideMerge(HostRegistration.layer),
  Layer.provideMerge(endpointConnection),
  Layer.provideMerge(platform),
);

const alive = (pid: number) =>
  Effect.try({
    try: () => {
      process.kill(pid, 0);
      return true;
    },
    catch: (cause) => new ProcessUnmeasured({ pid, cause }),
  }).pipe(
    Effect.catchIf(
      (failure) => Predicate.hasProperty(failure.cause, 'code') && failure.cause.code === 'ESRCH',
      () => Effect.succeed(false),
    ),
  );

describe.skipIf(!existsSync(LIBRARY))('the program road over a live execution host', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect('a program runs as the calling thread, reads its input on stdin, and stands in the command inventory under that thread', () =>
      Effect.gen(function* () {
        const { reader, checkout, projectId, thread, road } = yield* Fixture;
        const ending = yield* road.run({
          projectId,
          actor: { _tag: 'Thread', threadId: thread, projectId },
          argv: ['/bin/sh', '-c', 'cat; echo judged >&2'],
          cwd: checkout,
          stdin: '{"contract":1}',
          operation: `inspection/stest/${crypto.randomUUID()}`,
          subject: 'the inspection program under test',
        });
        expect(ending).toEqual({ _tag: 'Exited', exitCode: 0, stdout: '{"contract":1}', stderr: 'judged\n', cut: false });
        const listing = yield* reader.page(projectId, {
          limit: 20,
          owner: { _tag: 'Thread', thread },
        });
        const row = listing.readings.find(
          (reading) => reading.command.commandLine?.includes("exec /bin/sh -c 'cat; echo judged >&2' <") === true,
        );
        expect(row?.command.owner).toEqual({ _tag: 'Thread', thread });
        const input = row?.command.commandLine?.split('< ')[1] ?? '';
        expect(input.endsWith('input.json')).toBe(true);
        expect(yield* (yield* FileSystem.FileSystem).exists(input)).toBe(false);
      }),
    );

    it.effect('a program judging another project runs as the calling thread in its home, in that project’s checkout', () =>
      Effect.gen(function* () {
        const { checkout, context, store, projectId, thread, road } = yield* Fixture;
        const files = yield* FileSystem.FileSystem;
        const elsewhere = join(yield* files.makeTempDirectoryScoped({ prefix: 'program-elsewhere-' }), 'checkout');
        yield* files.copy(checkout, elsewhere);
        const row = yield* store.db
          .insert(project())
          .values({
            name: 'program-elsewhere',
            repoKey: elsewhere,
            rootPath: elsewhere,
            createdAt: new Date(yield* Clock.currentTimeMillis),
          })
          .returning({ id: project().id })
          .get();
        const other = row!.id;
        yield* Context.get(context, Coverage).cover(other);
        const ending = yield* road.run({
          projectId: other,
          actor: { _tag: 'Thread', threadId: thread, projectId },
          argv: ['/bin/sh', '-c', 'pwd -P'],
          cwd: elsewhere,
          stdin: '',
          operation: `inspection/stest/${crypto.randomUUID()}`,
          subject: 'a checker of another project',
        });
        expect(ending).toMatchObject({ _tag: 'Exited', exitCode: 0, stdout: `${yield* files.realPath(elsewhere)}\n` });
      }),
    );

    it.effect(
      'a program that is not installed answers unrun with the PATH it was searched on, and one that exits 127 itself is an ordinary exit',
      () =>
        Effect.gen(function* () {
          const { checkout, projectId, thread, road } = yield* Fixture;
          const missing = yield* road.run({
            projectId,
            actor: { _tag: 'Thread', threadId: thread, projectId },
            argv: ['tools/not-installed', 'a.ts'],
            cwd: checkout,
            stdin: '',
            operation: `commit-step/stest/${crypto.randomUUID()}`,
            subject: 'the commit step under test',
          });
          expect(missing._tag).toBe('Unrun');
          if (missing._tag !== 'Unrun') return;
          expect(missing.missing).toBe(process.env.PATH);
          const exited = yield* road.run({
            projectId,
            actor: { _tag: 'Thread', threadId: thread, projectId },
            argv: ['/bin/sh', '-c', 'exit 127'],
            cwd: checkout,
            stdin: '',
            operation: `commit-step/stest/${crypto.randomUUID()}`,
            subject: 'the commit step under test',
          });
          expect(exited).toMatchObject({ _tag: 'Exited', exitCode: 127 });
        }),
    );

    it.effect('a program whose caller is interrupted is stopped with its children before the call returns', () =>
      Effect.gen(function* () {
        const { checkout, projectId, thread, road } = yield* Fixture;
        const files = yield* FileSystem.FileSystem;
        const pidfile = join(checkout, 'step.pid');
        const fiber = yield* Effect.forkScoped(
          road.run({
            projectId,
            actor: { _tag: 'Thread', threadId: thread, projectId },
            argv: ['/bin/sh', '-c', `sleep 60 & echo $! > ${pidfile}; wait`],
            cwd: checkout,
            stdin: '',
            operation: `commit-step/stest/${crypto.randomUUID()}`,
            tool: 'commit-step',
            subject: 'the commit step under test',
          }),
        );
        yield* Effect.raceFirst(
          Effect.repeat(files.exists(pidfile), { until: (written) => written, schedule: Schedule.spaced('20 millis') }),
          Fiber.join(fiber).pipe(
            Effect.flatMap((ended) => Effect.die(new Error(`the program ended before publishing its child: ${JSON.stringify(ended)}`))),
          ),
        );
        const child = Number((yield* files.readFileString(pidfile)).trim());
        yield* Fiber.interrupt(fiber);
        expect(yield* alive(child)).toBe(false);
      }),
    );

    it.effect('operands far past the call envelope reach one program whole and in order, and its own exit code is the answer', () =>
      Effect.gen(function* () {
        const { checkout, projectId, thread, road } = yield* Fixture;
        const paths = Array.from({ length: 4_000 }, (_, at) => `src/a directory/with a long enough name ${String(at).padStart(5, '0')}.ts`);
        const ending = yield* road.run({
          projectId,
          actor: { _tag: 'Thread', threadId: thread, projectId },
          argv: ['/bin/sh', '-c', 'printf "%s\\n" "$@"; exit 3', 'operands'],
          operands: paths,
          cwd: checkout,
          stdin: '',
          operation: `commit-step/stest/${crypto.randomUUID()}`,
          tool: 'commit-step',
          subject: 'the operands under test',
        });
        expect(ending._tag).toBe('Exited');
        if (ending._tag !== 'Exited') return;
        expect(ending.exitCode).toBe(3);
        expect(ending.stdout.split('\n').filter((line) => line !== '')).toEqual(paths);
      }),
    );

    it.effect(
      "a program past the time its caller's command rule gives inspections is stopped by the host and answers late with what it printed",
      () =>
        Effect.gen(function* () {
          const { store, checkout, projectId, thread, road } = yield* Fixture;
          const written = yield* writeRule(store, {
            projectId,
            thread,
            through: 'inspection',
            program: null,
            measure: 'life',
            limitMs: 1_000,
            writer: `tagma:${thread}`,
            words: 'inspections get one second',
            position: { at: 'end' },
          });
          yield* Effect.addFinalizer(() => removeRule(store, written.rule.id).pipe(Effect.orDie));
          const ending = yield* road.run({
            projectId,
            actor: { _tag: 'Thread', threadId: thread, projectId },
            argv: ['/bin/sh', '-c', 'echo started >&2; sleep 30'],
            cwd: checkout,
            stdin: '{}',
            operation: `inspection/stest/${crypto.randomUUID()}`,
            subject: 'the inspection program under test',
          });
          expect(ending._tag).toBe('Stopped');
          if (ending._tag !== 'Stopped') return;
          expect(ending.late).toBe(true);
          expect(ending.stderr).toContain('started');
        }),
    );
  });
});
