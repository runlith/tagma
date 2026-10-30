import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress } from '@runlith/executions/hostAddress';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { Context, Effect, FileSystem, Layer, Ref } from 'effect';
import type { Tool } from '@runlith/agent/tool';
import { ToolAnswer, toolExecute } from '@runlith/agent/tool';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import { landedOf } from '@runlith/agent-tools/WorkspaceChanges';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { SessionIdentity } from '../../../platform/contract/wire/session.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { guardedFloor } from '../../../executions/testing/guardedFloor.js';
import { currentRules } from '../../../executions/store/standingRules.js';
import {
  checkoutWorldFor,
  commandAdmission,
  executionHost,
  executionPolicy,
  makeMachineWorld,
  terminalHostCustody,
  terminalThreads,
} from '../../../executions/testing/doubles.js';
import { shippedChain } from '../../../platform/store/chain.js';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { asThreadContext, worldTools } from '../../../native-harness/testing/doubles.js';
import { callerInThread } from '../callers';
import { fixtureMigrations } from '../migrations.js';
import { hostFixtureLayer, makeHostCase, HOST_LIBRARY as LIBRARY } from './fixture.js';

const INSTALLATION = InstallationId.make('managed-bash');
const thread = ThreadId.make('01a07000-0000-7000-8000-0000000000d1');

const unrecorded = {
  changes: () => ({
    land: <E, R>(_changes: readonly unknown[], write: Effect.Effect<boolean, E, R>) =>
      Effect.map(write, (written) => landedOf(written, false)),
    landEach: <E, R>(_changes: readonly unknown[], write: Effect.Effect<readonly boolean[], E, R>) =>
      Effect.map(write, (written) => written.map((one) => landedOf(one, false))),
    command: () => Effect.succeed(null),
  }),
};

const makeFixture = Effect.gen(function* () {
  const raised = yield* makeHostCase({ name: 'bash', installation: INSTALLATION, threads: [thread] });
  const connection = yield* executionHost(yield* hostAddress(raised.canonical, 'managed-bash'));
  const store = Context.get(raised.context, MachineStore);
  const units = Context.get(raised.context, MachineUnits);
  const custody = yield* terminalHostCustody({
    executions: connection.port,
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
  const floor = yield* guardedFloor({ port: connection.port, guarded: custody.guarded(), db: store.db, installation: INSTALLATION }).pipe(
    Effect.provide(context),
  );
  const access = yield* commandAdmission({
    commandRows: floor.stores.commandRows,
    register: terminalThreads({ db: store.db }),
    executions: custody.guarded(),
    rules: (project, owner, home) => Effect.map(currentRules(store, project, owner, home), (standing) => standing.map((one) => one.rule)),
  }).pipe(Effect.provideServiceEffect(ThreadLineage, lineageOver(store, units)), Effect.provide(context));
  const scope = yield* Effect.scope;
  const machine = makeMachineWorld(() => null);
  const world = yield* checkoutWorldFor(
    { id: thread, hostKind: null, hostId: null },
    raised.checkout,
    raised.projectId,
    'run-1',
    () => Effect.succeed({ scope, release: Effect.void }),
    {
      preferences: { checkout: () => Effect.succeed('managed' as const) },
      terminals: floor.terminals,
      writing: floor.terminals,
      evidence: floor.terminals,
      discharge: floor.terminals,
      managed: floor.terminals.commands,
      targets: floor.targets,
      host: connection,
      access,
      scratch: () => join(raised.caseHome, 'scratch'),
      world: machine,
    },
  );
  const bash = worldTools(
    asThreadContext({
      thread: { id: thread, model: null, authority: { mode: 'trust', bypassFrom: null } },
      world,
      projectId: raised.projectId,
      projectRoot: raised.checkout,
      machine: null,
      origin: null,
      settings: { value: () => Effect.succeed('shared') },
      commandTimes: unruledTimes,
      identity: sessionIdentity,
      grants: testGrantSigner,
      changeRecord: unrecorded,
      checkoutFlights: new CheckoutFlights(),
    }),
    { web: false },
  ).bash as Tool;
  return { bash, kind: world.kind };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/ManagedBashFixture') {}
const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const fixture = Layer.effect(Fixture, makeFixture).pipe(
  Layer.provide(hostFixtureLayer('managed-bash')),
  Layer.provideMerge(HostRegistration.layer),
  Layer.provideMerge(endpointConnection),
  Layer.provideMerge(platform),
);

const answerOf = Effect.fnUntraced(function* (input: { readonly command: string; readonly lifeMs?: number }, call: string) {
  const { bash } = yield* Fixture;
  const execute = toolExecute(bash);
  if (execute === null) return yield* Effect.die('bash declares no execute');
  const answer = yield* execute(
    { ...input, description: 'Print the output under test' },
    { toolCallId: call, caller: callerInThread(thread, 'run-1'), messages: [], prepared: null },
  );
  if (!(answer instanceof ToolAnswer)) return yield* Effect.die('bash returned no ToolAnswer');
  return String(answer.value);
});

const keptPath = (answer: string): string | undefined => /(\/\S+\/output\.log)\b/u.exec(answer)?.[1];

describe.skipIf(!existsSync(LIBRARY))('bash in a managed world over a live execution host', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect(
      'an answer that cannot carry the whole output names a file that holds it, also for a command its life stopped, and a short answer names none',
      () =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { kind } = yield* Fixture;
          const printed = Array.from({ length: 9000 }, (_, at) => `${at + 1}\n`).join('');
          const long = yield* answerOf({ command: 'seq 1 9000' }, 'call-long');
          const short = yield* answerOf({ command: 'printf hello' }, 'call-short');
          const stopped = yield* answerOf({ command: 'seq 1 9000; exec sleep 30', lifeMs: 1_000 }, 'call-stopped');
          const longFile = keptPath(long);
          const stoppedFile = keptPath(stopped);
          expect(kind).toBe('managed');
          expect(longFile === undefined ? undefined : yield* files.readFileString(longFile)).toBe(printed);
          expect(short).toContain('hello');
          expect(keptPath(short)).toBeUndefined();
          expect(stopped).toContain('life ran out');
          expect(stoppedFile === undefined ? undefined : yield* files.readFileString(stoppedFile)).toBe(printed);
        }),
    );
  });
});
