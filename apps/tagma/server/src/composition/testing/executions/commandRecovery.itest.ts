import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { join } from 'node:path';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress } from '@runlith/executions/hostAddress';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { Context, Duration, Effect, Fiber, FileSystem, Layer, Ref, Scope } from 'effect';
import type { Tool, ToolEffectSettlement } from '@runlith/agent/tool';
import { ToolAnswer, toolExecute, toolSettleEffect } from '@runlith/agent/tool';
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
import { hostFixtureLayer, makeHostCase } from './fixture.js';

const INSTALLATION = InstallationId.make('command-recovery');
const thread = ThreadId.make('01a07000-0000-7000-8000-0000000000d2');
const RUN = 'run-1';

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
  const raised = yield* makeHostCase({ name: 'recovery', installation: INSTALLATION, threads: [thread] });
  const connection = yield* executionHost(yield* hostAddress(raised.canonical, 'command-recovery'));
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
  const shell = Effect.gen(function* () {
    const world = yield* checkoutWorldFor(
      { id: thread, hostKind: null, hostId: null },
      raised.checkout,
      raised.projectId,
      RUN,
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
        successor: Effect.succeed(false),
        access,
        scratch: () => join(raised.caseHome, 'scratch'),
        world: machine,
      },
    );
    return worldTools(
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
  }).pipe(Scope.provide(scope));
  return { shell, checkout: raised.checkout, projectId: raised.projectId, commands: floor.terminals.commands, host: connection.port };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/CommandRecoveryFixture') {}
const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const fixture = Layer.effect(Fixture, makeFixture).pipe(
  Layer.provide(hostFixtureLayer('command-recovery')),
  Layer.provideMerge(HostRegistration.layer),
  Layer.provideMerge(endpointConnection),
  Layer.provideMerge(platform),
);

const appeared = Effect.fnUntraced(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (yield* files.exists(path)) return;
    yield* Effect.sleep(Duration.millis(50));
  }
  return yield* Effect.die(`${path} never appeared`);
});

const settledBy = Effect.fnUntraced(function* (bash: Tool, toolCallId: string, toolInput: unknown) {
  const settling = toolSettleEffect(bash, { toolCallId, toolInput, caller: callerInThread(thread, RUN) });
  if (settling === null) return yield* Effect.die('bash declares no settlement');
  return yield* settling;
});

const answerOf = (settlement: ToolEffectSettlement): ToolAnswer | null =>
  settlement.status === 'completed' && settlement.output instanceof ToolAnswer ? settlement.output : null;

describe('a bash call whose process died is settled from the command its correlation names', () => {
  layer(fixture, { excludeTestServices: true })('host', (it) => {
    it.effect('a command that outlived its call is moved to the background, then answered with its own ending and output', () =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { shell, checkout, projectId, commands, host } = yield* Fixture;
        const started = join(checkout, 'recovery-started');
        const release = join(checkout, 'recovery-release');
        const input = {
          command: `touch ${started}; until [ -e ${release} ]; do sleep 0.05; done; printf survived-its-call`,
          description: 'Outlive the call that started it',
        };
        const first = yield* shell;
        const execute = toolExecute(first);
        if (execute === null) return yield* Effect.die('bash declares no execute');
        const call = yield* Effect.forkChild(
          execute(input, { toolCallId: 'call-survives', caller: callerInThread(thread, RUN), messages: [], prepared: null }),
        );
        yield* appeared(started);
        yield* Fiber.interrupt(call);

        const recorded = yield* commands.startedBy(projectId, { thread, run: RUN, toolCall: 'call-survives' });
        expect(recorded?.record.origin).toMatchObject({ _tag: 'Thread', thread, run: RUN, toolCall: 'call-survives' });
        expect(recorded?.operation.startsWith('call-survives:')).toBe(true);
        const execution = recorded?.record.execution;
        if (execution === undefined) return yield* Effect.die('the command was never recorded');

        const running = answerOf(yield* settledBy(yield* shell, 'call-survives', input));
        expect(running?.display?.verb).toBe('Moved to the background');
        expect(running?.display?.reference).toMatchObject({ kind: 'command', execution: execution.execution, standing: true });
        expect(String(running?.value)).toContain('its process is running');

        yield* files.writeFileString(release, '');
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const summary = yield* host.state(execution);
          if (summary === undefined || summary.state.phase === 'ended') break;
          yield* Effect.sleep(Duration.millis(50));
        }
        const ended = answerOf(yield* settledBy(yield* shell, 'call-survives', input));
        expect(String(ended?.value)).toContain('survived-its-call');
        expect(String(ended?.value)).toContain('the checkout was NOT measured: the process that held this call died while its command ran');
        expect(ended?.display?.details?.[0]).toEqual({ label: 'exit', value: '0' });
        expect(ended?.display?.reference).toMatchObject({ kind: 'command', execution: execution.execution, standing: false });

        expect(yield* settledBy(yield* shell, 'call-never-admitted', input)).toEqual({ status: 'unknown' });
        expect(yield* commands.startedBy(projectId, { thread, run: 'run-2', toolCall: 'call-survives' })).toBeNull();
      }),
    );
  });
});
