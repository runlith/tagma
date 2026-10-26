import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { heldHost } from './posix/testing/holder';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { createTools } from '@runlith/agent-tools';
import { toolOptions } from '@runlith/agent-tools/testing/options';
import { type Tool, toolExecute } from '@runlith/agent/tool';
import { type World } from '@runlith/agent-tools/world';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { Deferred, Effect, Exit, FileSystem, Fiber, Layer, Schema, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import type { Executions } from '@runlith/executions/Executions';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { executionSpawner, SpawnAnnotation, type SpawnContext } from '@runlith/executions/executionSpawner';
import { managedCall } from '@runlith/executions/ManagedCall';
import type { HostAddress } from '@runlith/executions/hostAddress';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { Registration } from '@runlith/executions/protocol/registration';
import { type WireLimits } from '@runlith/executions/protocol/wire';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { hostPolicy, hostShare, hostWireLimits, registrationOf, serving, stateDirectories } from './hostFixture';

const LIBRARY = join(import.meta.dir, '..', 'native', 'target', 'release', 'libexecution_platform.dylib');
const ENTRY = join(import.meta.dir, 'main.ts');
const encodeBoot = Schema.encodeSync(Schema.fromJsonString(HostBoot));
const readPrincipal = Schema.decodeUnknownSync(Principal);
const readOperation = Schema.decodeUnknownSync(HostRequestKey);

const policy = hostPolicy({ executions: 8, transports: ['pipes'], custodyReceipts: 24 });
const limits: WireLimits = hostWireLimits(policy, 8, { envelopeBytes: 16384, connections: 4, requests: 8 });
const share = hostShare(policy, 8);

const directories = stateDirectories('shell-host-death-');
afterAll(directories.clear);

type Host = {
  readonly directory: string;
  readonly registration: Registration;
  readonly address: HostAddress;
  readonly child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  readonly logic: number;
};

const startHost = async (): Promise<Host> => {
  const directory = directories.open();
  const registration = registrationOf(directory);
  const boot = join(directory, 'boot.json');
  writeFileSync(boot, encodeBoot({ state: directory, registration, library: LIBRARY, policy, share, limits, lifetime: 'with-parent' }), {
    mode: 0o600,
  });
  const child = Bun.spawn(heldHost(ENTRY, boot), { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  await serving(child, registration.endpoint.path);
  const children = childrenOf(child.pid);
  const logic = children[0];
  if (children.length !== 1 || logic === undefined) throw new Error(`a fresh holder has no single logic: ${children}`);
  return {
    directory,
    registration,
    address: { state: registration.state, installation: registration.installation },
    child,
    logic,
  };
};

const environment: CommandEnvironment = {
  materialize: (request) =>
    Effect.sync(() => {
      const resolved = new Map<string, string>();
      if (request.inherit) {
        for (const [name, value] of Object.entries(process.env)) if (value !== undefined) resolved.set(name, value);
      }
      for (const entry of request.entries) {
        if (entry._tag === 'Unset') resolved.delete(entry.name);
        else resolved.set(entry.name, entry.value);
      }
      return [...resolved].map(([name, value]) => ({ name, value }));
    }),
};

const binding = (host: Host, root: string): SpawnContext => ({
  installation: host.registration.installation,
  purpose: 'internal',
  lifetime: 'call',
  correlation: 'shell-host-death',
  target: { environment: 'e', namespace: 'n', cwd: root, dependencies: [] },
  holder: readPrincipal('shell-tester'),
  origin: readPrincipal('shell-tester'),
  readerCredits: limits.credits,
});

const childrenOf = (pid: number): number[] =>
  new TextDecoder()
    .decode(Bun.spawnSync(['/usr/bin/pgrep', '-P', String(pid)]).stdout)
    .split('\n')
    .filter((line) => line !== '')
    .map(Number);

const killGroup = (pid: number): void => {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
};

const openRig = Effect.gen(function* () {
  const orphaned: number[] = [];
  const standing = yield* Effect.acquireRelease(Effect.promise(startHost), (host) =>
    Effect.promise(async () => {
      try {
        host.child.kill('SIGKILL');
      } catch {}
      await host.child.exited;
      for (const pid of orphaned) killGroup(pid);
    }),
  );
  const port = yield* ExecutionClient.make({ address: standing.address, role: 'custodian', limits });
  const first = yield* port.take({ installation: standing.registration.installation, operation: readOperation('shell-take') }, 0);
  if (first._tag === 'Stale') {
    yield* port.take(
      { installation: standing.registration.installation, operation: readOperation('shell-take-standing') },
      first.standing.revision,
    );
  }
  const root = join(standing.directory, 'work');
  const spawner = yield* executionSpawner(environment, binding(standing, root)).pipe(Effect.provide(ExecutionClient.context(port)));
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(root, { recursive: true });
  return {
    root,
    executions: port,
    spawner,
    world: {
      files: machineWorld.files,
      exec: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      git: machineWorld.git,
      working: machineWorld.working,
      environment: machineWorld.environment,
    },
    killHost: Effect.sync(() => {
      orphaned.push(...childrenOf(standing.child.pid));
      standing.child.kill('SIGKILL');
      process.kill(standing.logic, 'SIGKILL');
    }),
  };
});

const services = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));

const shellOf = (world: World, root: string): Tool => {
  const tool = createTools(toolOptions({ cwd: root, allowOutsideCwd: true, world })).bash;
  if (tool === undefined) throw new Error('the shell tools contain no bash');
  return tool;
};

const answer = (tool: Tool, input: unknown) => {
  const execute = toolExecute(tool);
  if (execute === null) return Effect.die('bash declares no execute');
  return execute(input, { toolCallId: 'shell-call', messages: [], caller: { agentId: 'shell-tester', ownerId: 'tester', thread: null } });
};

const waitForCommand = Effect.fnUntraced(function* (port: Executions['Service']) {
  for (;;) {
    const page = yield* port.list({ limit: 32 });
    const found = page.executions.find((execution) => execution.state.purpose === 'command' && execution.state.phase === 'running');
    if (found !== undefined) return found.state.ref;
    yield* Effect.sleep('20 millis');
  }
}, Effect.orDie);

layer(services, { excludeTestServices: true })('a managed call whose host dies', (it) => {
  it.effect('a shell command over a dying host answers unavailable instead of hanging', () =>
    Effect.gen(function* () {
      const rig = yield* openRig;
      const pending = yield* Effect.forkChild(
        answer(shellOf(rig.world, rig.root), { command: 'sleep 20', description: 'Outlast its host', waitMs: 30_000, lifeMs: 30_000 }),
      );
      yield* waitForCommand(rig.executions);
      yield* rig.killHost;
      const outcome = yield* Fiber.join(pending);
      expect(outcome).toMatchObject({ verdict: { kind: 'unknown' } });
    }),
  );

  it.effect('the companion result settles instead of waiting forever', () =>
    Effect.gen(function* () {
      const rig = yield* openRig;
      const spawned = yield* Deferred.make<void>();
      const pending = yield* Effect.forkChild(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const handle = yield* spawner.spawn(ChildProcess.make('/bin/sh', ['-c', 'sleep 20'])).pipe(
            Effect.provideService(SpawnAnnotation, {
              purpose: 'command',
              correlation: 'death-result',
              budget: { timeoutMs: 30_000 },
            }),
          );
          const call = managedCall(handle);
          if (call === undefined) return yield* Effect.die('a managed spawn must carry its companion');
          yield* Deferred.succeed(spawned, undefined);
          return yield* Effect.result(call.result);
        }).pipe(Effect.scoped, Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, rig.spawner)),
      );
      yield* Deferred.await(spawned);
      yield* rig.killHost;
      const outcome = yield* Fiber.join(pending);
      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure')
        expect(outcome.failure).toMatchObject({ _tag: 'PlatformError', reason: { _tag: 'BadResource', method: 'result' } });
    }),
  );

  it.effect('closing a managed scope finishes after the host dies', () =>
    Effect.gen(function* () {
      const rig = yield* openRig;
      const gate = yield* Scope.make();
      yield* Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        yield* spawner.spawn(ChildProcess.make('/bin/sh', ['-c', 'sleep 20'])).pipe(
          Effect.provideService(SpawnAnnotation, {
            purpose: 'command',
            correlation: 'death-scope',
            budget: { timeoutMs: 30_000 },
          }),
        );
      }).pipe(Scope.provide(gate), Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, rig.spawner));
      yield* waitForCommand(rig.executions);
      yield* rig.killHost;
      const closing = yield* Effect.forkChild(Scope.close(gate, Exit.void));
      yield* Fiber.join(closing);
    }),
  );
});
