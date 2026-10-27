import { Effect, Layer, type Scope } from 'effect';
import type { Commands, World } from '@runlith/agent-tools/world';
import { ChildProcessSpawner } from 'effect/process';
import { resolveEnvironment, type CommandEnvironment } from '@runlith/executions/CommandEnvironment';
import { executionSpawner } from '@runlith/executions/executionSpawner';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { offersCommands } from '@runlith/executions/protocol/capacity';
import { principalOf } from '../terminals/principals.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { WorldPreferences } from '../contract/service/worlds.js';
import { commandInspection } from '../contract/wire/commands.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { HostConnection } from '../host/connection.js';
import { executionWireLimits } from '../host/policy.js';
import { makeTerminalExecutions } from '../terminals/executionPort.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { TerminalTargets } from '../contract/service/targets.js';
import { WorldUnavailable, type LedgerKey, type ThreadWorld, type WorldThread } from '../contract/service/worlds.js';
import type { Discharge } from '../contract/service/discharge.js';
import type { ExecutionProcessEvidence } from '../contract/service/records.js';
import type { ManagedCommands } from '../contract/service/commands.js';
import type { Terminals } from '../contract/service/terminals.js';
import type { TerminalWriting } from '../contract/service/writing.js';
import { PreparedLaunches, makeShellCommands, shellAdmitter, type ShellCommandBinding } from './shell/start.js';
import { checkoutWorld } from './checkout.js';
import { CHECKOUT_FACTS } from '../contract/service/worlds.js';
import type { WorldLeasing } from './cache.js';

export const MANAGED_WORLD_KIND = 'managed';

export type CheckoutWorldServices = {
  readonly preferences: WorldPreferences['Service'];
  readonly terminals: Terminals['Service'];
  readonly writing: TerminalWriting['Service'];
  readonly evidence: ExecutionProcessEvidence['Service'];
  readonly discharge: Pick<Discharge['Service'], 'retire'>;
  readonly managed: ManagedCommands['Service'];
  readonly targets: TerminalTargets['Service'];
  readonly host: HostConnection;
  readonly access: CommandAccess['Service'];
  readonly projectOf: (threadId: string) => Effect.Effect<number | undefined, StoreFailure>;
  readonly scratch: (threadId: string) => string;
  readonly world: World;
  readonly commands?: (subject: LedgerKey) => Commands;
};

export const checkoutWorldFor = Effect.fnUntraced(function* (
  thread: WorldThread,
  root: string,
  runId: string,
  lease: WorldLeasing,
  deps: CheckoutWorldServices,
): Effect.fn.Return<ThreadWorld, WorldUnavailable, Scope.Scope> {
  const projectId = yield* deps.projectOf(thread.id).pipe(
    Effect.catch((failure) =>
      Effect.fail(
        new WorldUnavailable({
          threadId: thread.id,
          hostKind: null,
          reason: `the thread's project could not be read: ${failure._tag}`,
        }),
      ),
    ),
  );
  const scratch = deps.scratch(thread.id);
  const ledger = (substrate: 'managed' | 'platform'): Commands | undefined =>
    deps.commands?.({
      substrate,
      threadId: thread.id,
      projectId: projectId,
    });
  const platform = () => checkoutWorld({ projectRoot: root, scratch, world: deps.world, ...bound(ledger('platform')) });
  if (projectId === undefined) return platform();
  const setting = yield* deps.preferences.checkout().pipe(
    Effect.catch((failure) =>
      Effect.fail(
        new WorldUnavailable({
          threadId: thread.id,
          hostKind: null,
          reason: `the checkout world could not be selected: ${failure._tag}`,
        }),
      ),
    ),
  );
  if (setting !== 'managed') return platform();
  const standing = yield* Effect.result(deps.host.port.status());
  if (standing._tag === 'Failure') {
    if (standing.failure._tag === 'WireUnavailable' && standing.failure.kind === 'absent') {
      yield* Effect.logInfo('no execution host is installed, so the thread works in the platform world', {
        threadId: thread.id,
        failure: standing.failure,
      });
    } else {
      yield* Effect.logWarning('the execution host did not answer its status, so the thread works in the platform world', {
        threadId: thread.id,
        failure: standing.failure,
      });
    }
    return platform();
  }
  return yield* managedWorld({
    threadId: thread.id,
    projectId,
    runId,
    lease,
    root,
    scratch,
    world: deps.world,
    terminals: deps.terminals,
    writing: deps.writing,
    evidence: deps.evidence,
    discharge: deps.discharge,
    managed: deps.managed,
    host: deps.host,
    targets: deps.targets,
    access: deps.access,
    ...bound(ledger('managed')),
  });
});

export type ManagedWorldInput = {
  readonly threadId: string;
  readonly projectId: number;
  readonly runId: string;
  readonly lease: WorldLeasing;
  readonly root: string;
  readonly scratch: string;
  readonly world: World;
  readonly terminals: Terminals['Service'];
  readonly writing: TerminalWriting['Service'];
  readonly evidence: ExecutionProcessEvidence['Service'];
  readonly discharge: Pick<Discharge['Service'], 'retire'>;
  readonly managed: ManagedCommands['Service'];
  readonly host: HostConnection;
  readonly targets: TerminalTargets['Service'];
  readonly access: CommandAccess['Service'];
  readonly commands?: Commands;
};

const bound = (commands: Commands | undefined): { readonly commands?: Commands } => (commands === undefined ? {} : { commands });

const processVariables = (): ReadonlyMap<string, string> =>
  new Map(Object.entries(process.env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value] as const])));

const entriesOf = (env: Record<string, string | undefined>) =>
  Object.entries(env).flatMap((entry) => {
    const [name, value] = entry;
    if (name.length === 0) return [];
    return [value === undefined ? ({ _tag: 'Unset', name } as const) : ({ _tag: 'Set', name, value } as const)];
  });

const processEnvironment: CommandEnvironment = {
  materialize: (request) => Effect.succeed(resolveEnvironment(processVariables(), request)),
};

const caller = (actor: { readonly _tag: 'Thread'; readonly threadId: ThreadId; readonly projectId: number }, input: ManagedWorldInput) =>
  ({ actor, projectId: input.projectId, runId: input.runId, kind: 'host', root: input.root }) as const;

export const managedWorld = Effect.fnUntraced(function* (
  input: ManagedWorldInput,
): Effect.fn.Return<ThreadWorld, WorldUnavailable, Scope.Scope> {
  const target = yield* input.targets
    .resolve({
      projectId: input.projectId,
      kind: 'host',
      cwd: input.root,
    })
    .pipe(
      Effect.catch((refusal) =>
        Effect.fail(
          new WorldUnavailable({
            threadId: input.threadId,
            hostKind: null,
            reason: `the checkout target would not resolve: ${refusal._tag}${'reason' in refusal ? ` (${String(refusal.reason)})` : ''}`,
          }),
        ),
      ),
    );
  const actor = { _tag: 'Thread', threadId: ThreadId.make(input.threadId), projectId: input.projectId } as const;
  const principal = principalOf(actor);
  const launches = new PreparedLaunches();
  const port = makeTerminalExecutions({
    terminals: input.terminals,
    writing: input.writing,
    evidence: input.evidence,
    discharge: input.discharge,
    host: input.host,
    caller: caller(actor, input),
    scope: yield* Effect.scope,
    admit: shellAdmitter(launches, input.access),
  });
  const offered = yield* Effect.result(input.host.port.capabilities());
  if (offered._tag === 'Failure') {
    yield* Effect.logInfo('the execution host did not name its capabilities, so the thread runs commands in the platform world', {
      threadId: input.threadId,
      reason: offered.failure._tag,
    });
  }
  const carriesCommands = offered._tag === 'Success' && offersCommands(offered.success);
  const binding: ShellCommandBinding = {
    installation: input.host.installation,
    projectId: input.projectId,
    actor,
    owner: { _tag: 'Thread', thread: ThreadId.make(input.threadId) },
    creator: { _tag: 'Thread', thread: ThreadId.make(input.threadId), run: input.runId },
    target,
    environment: (env) => resolveEnvironment(processVariables(), { inherit: true, entries: entriesOf(env) }),
    credits: executionWireLimits.credits,
    inspect: commandInspection,
  };
  const spawner = yield* executionSpawner(processEnvironment, {
    installation: input.host.installation,
    purpose: 'internal',
    lifetime: 'call',
    correlation: 'world',
    target: {
      environment: target.binding.environmentId,
      namespace: target.binding.namespaceId,
      cwd: input.root,
      dependencies: [],
    },
    holder: principal,
    origin: principal,
    readerCredits: executionWireLimits.credits,
  }).pipe(Effect.provide(ExecutionClient.context(port)));
  return {
    kind: MANAGED_WORLD_KIND,
    substrate: 'managed',
    facts: CHECKOUT_FACTS,
    world: {
      ...input.world,
      exec: Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      commandWork: carriesCommands
        ? makeShellCommands({ executions: port, access: input.access, launches, binding, lease: input.lease, managed: input.managed })
        : input.world.commandWork,
      ...bound(input.commands),
    },
    root: input.root,
    scratch: input.scratch,
    alive: () => true,
  } satisfies ThreadWorld;
});
