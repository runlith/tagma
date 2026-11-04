import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { afterAll, describe, expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';
import { heldHost, HOLDER_LIBRARY } from './posix/testing/holder';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as BunServices from '@effect/platform-bun/BunServices';
import { createTools } from '@runlith/agent-tools';
import type { ToolVerdict } from '@runlith/agent/tool';
import { toolOptions } from '@runlith/agent-tools/testing/options';
import { type FinishedCommand, type World } from '@runlith/agent-tools/world';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { Context, Deferred, Effect, FileSystem, Fiber, Layer, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import type { Executions } from '@runlith/executions/Executions';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { executionSpawner, SpawnAnnotation, type SpawnContext } from '@runlith/executions/executionSpawner';
import { managedCall } from '@runlith/executions/ManagedCall';
import type { HostAddress } from '@runlith/executions/hostAddress';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Principal } from '@runlith/executions/protocol/custody';
import { HostRequestKey, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { Registration } from '@runlith/executions/protocol/registration';
import { type WireLimits } from '@runlith/executions/protocol/wire';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { hostPolicy, hostShare, hostWireLimits, registrationOf, serving, stateDirectories } from './hostFixture';

const LIBRARY = HOLDER_LIBRARY;
const ENTRY = join(import.meta.dir, 'main.ts');
const encodeBoot = Schema.encodeSync(Schema.fromJsonString(HostBoot));
const readPrincipal = Schema.decodeUnknownSync(Principal);
const readOperation = Schema.decodeUnknownSync(HostRequestKey);

const policy = hostPolicy({ executions: 8, transports: ['pipes'], custodyReceipts: 24 });
const limits: WireLimits = hostWireLimits(policy, 8, { envelopeBytes: 16384, connections: 4, requests: 8 });
const share = hostShare(policy, 8);

const directories = stateDirectories('managed-shell-');
afterAll(directories.clear);

type Host = {
  readonly directory: string;
  readonly registration: Registration;
  readonly address: HostAddress;
  readonly child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  readonly said: () => string;
};

const startHost = async (): Promise<Host> => {
  const directory = directories.open();
  const registration = registrationOf(directory);
  const boot = join(directory, 'boot.json');
  writeFileSync(boot, encodeBoot({ state: directory, registration, library: LIBRARY, policy, share, limits, lifetime: 'with-parent' }), {
    mode: 0o600,
  });
  const child = Bun.spawn(heldHost(ENTRY, boot), { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const said = await serving(child, registration.endpoint.path);
  return {
    directory,
    registration,
    address: { state: registration.state, installation: registration.installation },
    child,
    said,
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
  correlation: 'managed-shell',
  target: { environment: 'e', namespace: 'n', cwd: root, dependencies: [] },
  holder: readPrincipal('shell-tester'),
  origin: readPrincipal('shell-tester'),
  readerCredits: limits.credits,
});

class Shell extends Context.Service<
  Shell,
  {
    readonly host: Host;
    readonly root: string;
    readonly port: Executions['Service'] & HostAuthority['Service'];
    readonly spawner: ChildProcessSpawner.ChildProcessSpawner['Service'];
    readonly world: World;
  }
>()('execution-host/testing/managedShell/Shell') {}

const shellRig = Layer.effect(
  Shell,
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(Effect.promise(startHost), (standing) =>
      Effect.promise(async () => {
        standing.child.kill('SIGKILL');
        await standing.child.exited;
      }),
    );
    const port = yield* ExecutionClient.make({ address: host.address, role: 'custodian', limits });
    const first = yield* port.take({ installation: host.registration.installation, operation: readOperation('shell-take') }, 0);
    if (first._tag === 'Stale') {
      yield* port.take(
        { installation: host.registration.installation, operation: readOperation('shell-take-standing') },
        first.standing.revision,
      );
    }
    const root = join(host.directory, 'work');
    const spawner = yield* executionSpawner(environment, binding(host, root)).pipe(Effect.provide(ExecutionClient.context(port)));
    const files = yield* FileSystem.FileSystem;
    yield* files.makeDirectory(root, { recursive: true });
    return Shell.of({
      host,
      root,
      port,
      spawner,
      world: {
        files: machineWorld.files,
        exec: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        git: machineWorld.git,
        working: machineWorld.working,
        environment: machineWorld.environment,
      },
    });
  }),
).pipe(Layer.provide(HostRegistration.layer), Layer.provide(endpointConnection), Layer.provide(BunServices.layer));

type Display = {
  readonly form?: string;
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly details?: readonly { readonly label: string; readonly value: string }[];
};
type ShellTool = {
  readonly execute?: (
    input: unknown,
    call: { readonly toolCallId: string; readonly messages: readonly never[] },
  ) => Effect.Effect<
    {
      readonly value: unknown;
      readonly display?: Display;
      readonly verdict?: ToolVerdict;
    },
    { readonly reason: string }
  >;
};

const shellOf = (world: World, root: string): ShellTool =>
  createTools(toolOptions({ cwd: root, allowOutsideCwd: true, world })).bash as unknown as ShellTool;

type Answer = { readonly text: string; readonly display: Display | undefined; readonly verdict: ToolVerdict | undefined };

const answer = (tool: ShellTool, input: unknown): Effect.Effect<Answer> => {
  const execute = tool.execute;
  if (execute === undefined) return Effect.die('bash declares no execute');
  return execute(input, { toolCallId: 'shell-call', messages: [] }).pipe(
    Effect.match({
      onFailure: (failure): Answer => ({ text: failure.reason, display: undefined, verdict: undefined }),
      onSuccess: (settled): Answer => ({ text: String(settled.value), display: settled.display, verdict: settled.verdict }),
    }),
  );
};

const fact = (display: Display | undefined): { readonly label: string; readonly value: string } | undefined =>
  display?.form === 'command' ? (display.facts?.[0] ?? display.details?.[0]) : undefined;

const executionOf = (handle: ChildProcessSpawner.ChildProcessHandle) => {
  const call = managedCall(handle);
  return call === undefined ? Effect.die('a managed spawn must carry its companion') : Effect.succeed(call.execution);
};

type OpenedWorld = { readonly world: World; readonly opened: Effect.Effect<ExecutionRef> };
const openedWorld = Effect.fnUntraced(function* (shell: Shell['Service']) {
  const opened = yield* Deferred.make<ExecutionRef>();
  const exec = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      shell.spawner.spawn(command).pipe(
        Effect.updateService(SpawnAnnotation, (annotation) => ({ ...annotation, budget: {} })),
        Effect.tap((handle) => Effect.flatMap(executionOf(handle), (ref) => Deferred.succeed(opened, ref))),
      ),
    ),
  );
  return { world: { ...shell.world, exec }, opened: Deferred.await(opened) } satisfies OpenedWorld;
});

layer(shellRig, { excludeTestServices: true })('bash over a managed execution host', (it) => {
  it.effect('a command whose life ran out and then exited zero is answered as killed at its life, not a success', () =>
    Effect.gen(function* () {
      const { world, root } = yield* Shell;
      const ran = yield* answer(shellOf(world, root), {
        command: `trap 'exit 0' INT TERM; /usr/bin/perl -e 'sleep while 1'`,
        description: 'Handle the signal and exit zero',
        lifeMs: 400,
      });

      expect(fact(ran.display)).toEqual({ label: 'ended', value: 'life ran out' });
      expect(ran.verdict).toMatchObject({ kind: 'failed' });
    }),
  );

  it.effect('a foreign signal early in a long deadline is the native fact, never a timeout', () =>
    Effect.gen(function* () {
      const { world, root } = yield* Shell;
      const ran = yield* answer(shellOf(world, root), {
        command: 'kill -QUIT $$',
        description: 'Die by a signal',
        lifeMs: 30_000,
      });

      expect(fact(ran.display)).toEqual({ label: 'ended', value: 'killed' });
      expect(ran.text).toContain('SIGQUIT');
    }),
  );

  it.effect('a run stopped mid-command takes its execution down for the cause it was stopped for, not a life that ran out', () =>
    Effect.gen(function* () {
      const shell = yield* Shell;
      const { port } = shell;
      const ready = yield* openedWorld(shell);
      const execute = shellOf(ready.world, shell.root).execute;
      if (execute === undefined) return yield* Effect.die('bash declares no execute');
      const running = yield* Effect.forkChild(
        execute(
          { command: 'exec /usr/bin/perl -e "sleep while 1"', description: 'Wait to be stopped' },
          { toolCallId: 'shell-call', messages: [] },
        ),
      );
      const target = yield* ready.opened;
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(running));
      const decided = yield* Effect.gen(function* () {
        for (;;) {
          const summary = yield* port.state(target);
          if (summary?.decision !== undefined) return summary;
          yield* Effect.sleep('20 millis');
        }
      }).pipe(Effect.orDie);
      yield* Fiber.join(interrupting);

      expect(decided.decision).toMatchObject({ _tag: 'Cancelled', cause: 'scope-closed' });
    }),
  );

  it.effect('a stop nobody in this run asked for is stopped with its own cause, not the user’s', () =>
    Effect.gen(function* () {
      const shell = yield* Shell;
      const { port, host } = shell;
      const ready = yield* openedWorld(shell);
      const running = yield* Effect.forkChild(
        answer(shellOf(ready.world, shell.root), {
          command: 'exec /usr/bin/perl -e "sleep while 1"',
          description: 'Wait to be stopped by another holder',
        }),
      );
      const target = yield* ready.opened;
      yield* port
        .stop({ installation: host.registration.installation, operation: readOperation('outside-stop') }, target, 'explicit-stop', 'signal')
        .pipe(Effect.orDie);
      const ran = yield* Fiber.join(running);

      expect(fact(ran.display)).toEqual({ label: 'ended', value: 'stopped' });
      expect(ran.text).toContain('explicit-stop');
      expect(ran.text).not.toContain('User aborted the command');
    }),
  );

  it.effect('a running bash command is one execution of the host, declared as a command', () =>
    Effect.gen(function* () {
      const shell = yield* Shell;
      const { port } = shell;
      const ready = yield* openedWorld(shell);
      const files = yield* FileSystem.FileSystem.pipe(Effect.provide(BunServices.layer));
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'visible-command-' });
      const release = join(directory, 'release');
      const running = yield* Effect.forkChild(
        answer(shellOf(ready.world, shell.root), {
          command: `while [ ! -f '${release}' ]; do sleep 0.01; done`,
          description: 'Be visible',
        }),
      );
      const target = yield* ready.opened;

      const summary = yield* port.state(target).pipe(Effect.orDie);
      expect(summary?.state.purpose).toBe('command');
      expect(summary?.state.lifetime).toBe('call');
      expect(Number(summary?.native.pid ?? 0)).toBeGreaterThan(0);

      yield* files.writeFileString(release, 'released');
      const ran = yield* Fiber.join(running);
      expect(fact(ran.display)).toEqual({ label: 'exit', value: '0' });
    }),
  );

  it.effect('an unannotated spawn keeps the binding it was built with, and an annotated one replaces it', () =>
    Effect.gen(function* () {
      const { spawner, port } = yield* Shell;
      const purposes = yield* Effect.gen(function* () {
        const plain = yield* executionOf(yield* spawner.spawn(ChildProcess.make('/usr/bin/perl', ['-e', 'sleep while 1'])));
        const noted = yield* executionOf(
          yield* spawner
            .spawn(ChildProcess.make('/usr/bin/perl', ['-e', 'sleep while 1']))
            .pipe(Effect.provideService(SpawnAnnotation, { purpose: 'command', correlation: 'annotated' })),
        );
        const read = (ref: typeof plain) => Effect.map(port.state(ref), (summary) => summary?.state.purpose);
        return { plain: yield* read(plain), noted: yield* read(noted) };
      }).pipe(Effect.scoped, Effect.orDie);

      expect(purposes.plain).toBe('internal');
      expect(purposes.noted).toBe('command');
    }),
  );

  it.effect('a child bound to this process is refused, and one that outlives it is not', () =>
    Effect.gen(function* () {
      const { spawner } = yield* Shell;
      const outcome = yield* Effect.gen(function* () {
        const bad = yield* Effect.result(spawner.spawn(ChildProcess.make('/bin/echo', ['x'], { detached: false })));
        const good = yield* Effect.result(spawner.spawn(ChildProcess.make('/bin/echo', ['x'], { detached: true })));
        return {
          refused: bad._tag === 'Failure' ? bad.failure.reason.description : null,
          accepted: good._tag === 'Success',
        };
      }).pipe(Effect.scoped);

      expect(outcome.accepted).toBe(true);
      expect(outcome.refused).toContain('detached: false');
    }),
  );

  it.effect('a finished managed command is recorded once with native cost', () =>
    Effect.gen(function* () {
      const { world, root } = yield* Shell;
      const recorded: Array<FinishedCommand> = [];
      const shell = shellOf(
        {
          ...world,
          commands: { finished: (command) => Effect.sync(() => void recorded.push(command)) },
        },
        root,
      );
      yield* answer(shell, { command: 'printf measured', description: 'Print a word', lifeMs: 30_000 });

      expect(recorded.map(({ exit, cost }) => ({ exit, cost }))).toEqual([
        { exit: { _tag: 'Code', code: 0 }, cost: expect.objectContaining({ _tag: 'Measured' }) },
      ]);
    }),
  );

  it.effect('a command that simply succeeds answers its exit and its output', () =>
    Effect.gen(function* () {
      const { world, root } = yield* Shell;
      const ran = yield* answer(shellOf(world, root), { command: 'printf hello', description: 'Print a word' });

      expect(ran.text).toContain('hello');
      expect(fact(ran.display)).toEqual({ label: 'exit', value: '0' });
      expect(ran.verdict).toEqual({ kind: 'answered' });
    }),
  );
});

describe('bash over the ordinary platform world', () => {
  it.live('a generic catalog runs commands and kills them at their life with no host in sight', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'platform-shell-' });
      const shell = shellOf(machineWorld, root);
      const ok = yield* answer(shell, { command: 'printf plain', description: 'Print a word' });
      expect(ok.text).toContain('plain');
      expect(fact(ok.display)).toEqual({ label: 'exit', value: '0' });

      const late = yield* answer(shell, { command: 'exec /usr/bin/perl -e "sleep while 1"', description: 'Outlast its life', lifeMs: 300 });
      expect(fact(late.display)).toEqual({ label: 'ended', value: 'life ran out' });
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
