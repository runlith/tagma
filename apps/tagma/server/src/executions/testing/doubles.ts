import { Context, Effect, Layer, Queue, Stream } from 'effect';
import { TerminalAdopters } from '../contract/service/adopters.js';
import { TerminalTargets } from '../contract/service/targets.js';
import { TerminalGrants } from '../contract/service/grants.js';
import { CommandWaiters } from '../contract/service/commands.js';
import { Terminals } from '../contract/service/terminals.js';
import { Discharge } from '../contract/service/discharge.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { TerminalRows } from '../store/terminalRows.js';
import { CommandRows } from '../store/commandRows.js';
import { CommandDeliveries } from '../store/deliveries.js';
import { TerminalReconciliation } from '../terminals/reconciliation.js';
import { TerminalInventory } from '../terminals/inventory.js';
import { InputWitness } from '../terminals/gridControl.js';
import { TerminalWriters } from '../terminals/writers.js';
import { RootUses } from '../../workspace/contract/service/roots.js';
import { Environments } from '../../workspace/contract/service/environments.js';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { WireUnavailable } from '@runlith/executions/Executions';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import { TargetKey } from '../contract/wire/targets.js';
import type { InteractiveGrant } from '../contract/wire/terminals.js';
import { makeCommandAccess } from '../commands/access.js';
import { admittedGit as admittedGitFn } from '../commands/admittedGit.js';
import { makeCommandFeed } from '../commands/feed.js';
import { makeCommandOutput } from '../commands/output.js';
import { makeOutputSearch } from '../commands/search.js';
import { resolveCommandPolicy as resolveCommandPolicyFn } from '../commands/policy.js';
import { makeStoredCommands } from '../commands/reader.js';
import { terminalProgramRoad } from '../commands/programRoad.js';
import { removeRule as removeRuleFn, writeRule as writeRuleFn } from '../commands/ruleLedger.js';
import { makeServingGit } from '../commands/servingGit.js';
import { makeCommandWaiters } from '../commands/waiters.js';
import { hostBundle as hostBundleFn } from '../host/boot.js';
import {
  HostConnection,
  hostServices,
  type HostExecutions,
  executionHost as executionHostFn,
  executionState as executionStateFn,
} from '../host/connection.js';
import { makeTerminalHostCustody } from '../host/custody.js';
import { hostEnvironment as backendEnvironment, makeHostEnvironment } from '../host/environmentBackend.js';
import { executionPolicy as policyValue, executionWireLimits as wireLimitsValue } from '../host/policy.js';
import { COMMAND_RULE_PAIRS as rulePairs } from '../operations/commandRules.js';
import { EXECUTION_SETTING_KEYS as settingKeys } from '../settings.js';
import { commandRule as commandRuleTable } from '../store/commandRule.js';
import { RETAINED_OPERATION_KEYS as retainedKeys } from '../store/requestKeys.js';
import {
  command as commandTable,
  commandWait as commandWaitTable,
  custodyNotice as custodyNoticeTable,
  terminal as terminalTable,
  terminalIntent as terminalIntentTable,
  terminalRequestKey as terminalRequestKeyTable,
} from '../store/terminal.js';
import { makeTerminalAccess } from '../terminals/access.js';
import { terminalChannel as terminalChannelFn } from '../terminals/channel.js';
import { sweepKeyOf as sweepKeyOfFn } from '../terminals/discharge.js';
import { makeTerminalEndings } from '../terminals/endings.js';
import type { TerminalWatched } from '../contract/service/endings.js';
import { makeTerminalExecutions } from '../terminals/executionPort.js';
import type { CommandAdmitter } from '../terminals/executionPort.js';
import { makeTerminalGrants } from '../terminals/grantBook.js';
import { makeExecutionGrids } from '../terminals/gridControl.js';
import { makeHostTerminals } from '../terminals/hostTerminals.js';
import { makeTerminalInventory } from '../terminals/inventory.js';
import { LANE_GRACE_MS as laneGraceMs, makeTerminalLanes } from '../terminals/lanes.js';
import { makeTerminalReconciliation } from '../terminals/reconciliation.js';
import { runRetention as runRetentionFn } from '../terminals/retention.js';
import { makeTerminalTargets } from '../terminals/targets.js';
import { makeTerminalThreads } from '../terminals/threads.js';
import { makeTerminalWriters } from '../terminals/writers.js';
import { makeLeasedWorlds } from '../worlds/cache.js';
import { checkoutWorld as checkoutWorldFn } from '../worlds/checkout.js';
import { makeMachineWorld as makeMachineWorldFn } from '../worlds/machine.js';
import { checkoutWorldFor as checkoutWorldForFn } from '../worlds/managed.js';
import { setupCommands as setupCommandsImpl } from '../commands/setup.js';
import { endHosts as endHostsImpl, hostsUnder as hostsUnderImpl } from '../host/processes.js';

export const commandAdmission = (...input: Parameters<typeof makeCommandAccess>) => makeCommandAccess(...input);

export const commandOutputReader = (...input: Parameters<typeof makeCommandOutput>) => makeCommandOutput(...input);

export const commandOutputSearch = (...input: Parameters<typeof makeOutputSearch>) => makeOutputSearch(...input);

export const storedCommands = (...input: Parameters<typeof makeStoredCommands>) => makeStoredCommands(...input);

export const programRoad = (...input: Parameters<typeof terminalProgramRoad>) => terminalProgramRoad(...input);

export const sharedCommandFeed = (...input: Parameters<typeof makeCommandFeed>) => makeCommandFeed(...input);

export const commandNoticeQueue = (...input: Parameters<typeof makeCommandWaiters>) => makeCommandWaiters(...input);

export const hostConnection = (...input: ConstructorParameters<typeof HostConnection>): HostConnection => new HostConnection(...input);

export const terminalHostCustody = (...input: Parameters<typeof makeTerminalHostCustody>) => makeTerminalHostCustody(...input);

export const executionHost = (...input: Parameters<typeof executionHostFn>) => executionHostFn(...input);

export const hostEnvironment = (...input: Parameters<typeof makeHostEnvironment>) => makeHostEnvironment(...input);

export const terminalAdmission = (...input: Parameters<typeof makeTerminalAccess>) => makeTerminalAccess(...input);

type EndingsFixture = Parameters<typeof makeTerminalEndings>[0] & {
  readonly terminals: Terminals['Service'];
  readonly discharge: Discharge['Service'];
  readonly terminalRows: TerminalRows;
  readonly commandRows: CommandRows;
};

export const terminalEndings = (input: EndingsFixture) =>
  makeTerminalEndings(input).pipe(
    Effect.provide(
      Context.make(Terminals, input.terminals).pipe(
        Context.add(Discharge, input.discharge),
        Context.add(TerminalRows, input.terminalRows),
        Context.add(CommandRows, input.commandRows),
      ),
    ),
  );

export const terminalExecutions = (...input: Parameters<typeof makeTerminalExecutions>) => makeTerminalExecutions(...input);

export const grantBook = (...input: Parameters<typeof makeTerminalGrants>) => makeTerminalGrants(...input);

export const threadActor = (threadId: string) => Principal.make(`thread:${threadId}`);

export const interactiveGrant = (input: {
  readonly threadId: string;
  readonly execution: string;
  readonly binding: string;
  readonly runId?: string;
}): InteractiveGrant => ({
  projectId: 1,
  execution: { installation: InstallationId.make('test-installation'), execution: ExecutionId.make(input.execution), incarnation: 1 },
  actor: threadActor(input.threadId),
  targetKey: TargetKey.make('target-under-test'),
  binding: BindingId.make(input.binding),
  permissionRevision: 0,
  runId: input.runId,
});

export const grantBookOver = (host: 'acknowledges' | 'unreachable', closed: string[]) =>
  makeTerminalGrants({
    executions: {
      closeBinding: (binding: BindingId) =>
        Effect.flatMap(
          Effect.sync(() => {
            closed.push('closeBinding');
          }),
          () =>
            host === 'acknowledges'
              ? Effect.succeed({ _tag: 'Unbound' as const, binding })
              : Effect.fail(new WireUnavailable({ kind: 'unreachable', reason: 'the host is gone', sent: false })),
        ),
    } as unknown as TerminalInput['Service'],
  });

export const executionGrids = (...input: Parameters<typeof makeExecutionGrids>) => makeExecutionGrids(...input);

type FloorInput = Parameters<typeof makeHostTerminals>[0] & {
  readonly executions: HostExecutions;
  readonly targets: TerminalTargets['Service'];
  readonly requestKeys: RequestKeys;
  readonly intents: TerminalIntents;
  readonly terminalRows: TerminalRows;
  readonly commandRows: CommandRows;
  readonly deliveries: CommandDeliveries;
  readonly grants: TerminalGrants['Service'];
  readonly reconciliation: TerminalReconciliation;
  readonly cell: TerminalInventory;
  readonly waiters: CommandWaiters['Service'];
  readonly witness?: InputWitness;
  readonly writers?: TerminalWriters | null;
};

export const unreadHost: HostExecutions = {
  list: () => Effect.die('this fixture does not list the host'),
  changes: () => Effect.die('this fixture does not read host changes'),
  state: () => Effect.die('this fixture does not read host state'),
  ending: () => Effect.die('this fixture does not read a host ending'),
  retained: () => Effect.die('this fixture does not read retained output'),
  start: () => Effect.die('this fixture does not start host work'),
  cancelStart: () => Effect.die('this fixture does not cancel host work'),
  signal: () => Effect.die('this fixture does not signal host work'),
  stop: () => Effect.die('this fixture does not stop host work'),
  retire: () => Effect.die('this fixture does not retire host work'),
  command: () => Effect.die('this fixture does not read a host command'),
  commands: () => Effect.die('this fixture does not list host commands'),
  commandsAt: () => Effect.die('this fixture does not read host commands by key'),
  revise: () => Effect.die('this fixture does not revise a host command'),
  operation: () => Effect.die('this fixture does not read a host operation'),
  callResult: () => Effect.die('this fixture does not read a host call'),
  read: () => Effect.die('this fixture does not read host bytes'),
  subscribe: () => Stream.fromEffect(Effect.die('this fixture does not follow the host')),
  screen: () => Effect.die('this fixture does not read a host screen'),
  point: () => Effect.die('this fixture does not read a host screen'),
  input: () => Effect.die('this fixture does not type into the host'),
  openBinding: () => Effect.die('this fixture does not open a host lane'),
  closeBinding: () => Effect.die('this fixture does not close a host lane'),
  open: () => Effect.die('this fixture does not open a terminal endpoint lane'),
  inputs: () => Effect.die('this fixture does not follow admitted input'),
  custody: () => Effect.die('this fixture does not transfer host custody'),
  processes: () => Effect.die('this fixture does not read host processes'),
  foreground: () => Effect.die('this fixture does not read the host foreground'),
  listeners: () => Effect.die('this fixture does not read host listeners'),
  hostListeners: () => Effect.die('this fixture does not read machine listeners'),
  load: () => Effect.die('this fixture does not read host load'),
  status: () => Effect.die('this fixture does not read host status'),
  capabilities: () => Effect.die('this fixture does not read host capabilities'),
  served: () => Effect.die('this fixture does not read host service'),
  generation: () => Effect.die('this fixture does not read host generation'),
  quiesce: () => Effect.die('this fixture does not quiesce the host'),
  resume: () => Effect.die('this fixture does not resume the host'),
  prepare: () => Effect.die('this fixture does not prepare the host'),
  yield: () => Effect.die('this fixture does not replace the host'),
  shutdown: () => Effect.die('this fixture does not shut down the host'),
  pace: () => Effect.die('this fixture does not pace the host'),
  disown: () => Effect.die('this fixture does not disown host work'),
  endProcess: () => Effect.die('this fixture does not end a host process'),
  endResidual: () => Effect.die('this fixture does not end a host residual'),
};

export const hostTerminals = (over: Partial<FloorInput>) => {
  const input = over as FloorInput;
  const port: HostExecutions = { ...unreadHost, ...over.executions };
  const owners = hostServices(port).pipe(
    Context.add(RequestKeys, input.requestKeys),
    Context.add(TerminalIntents, input.intents),
    Context.add(TerminalRows, input.terminalRows),
    Context.add(CommandRows, input.commandRows),
    Context.add(CommandDeliveries, input.deliveries),
    Context.add(TerminalTargets, input.targets),
    Context.add(TerminalGrants, input.grants ?? makeTerminalGrants({ executions: port })),
    Context.add(TerminalReconciliation, input.reconciliation),
    Context.add(TerminalInventory, input.cell),
    Context.add(CommandWaiters, input.waiters),
    Context.add(
      InputWitness,
      input.witness ?? {
        admitted: () => Effect.void,
        reported: () => Effect.void,
        ended: () => Effect.void,
        transferred: () => Effect.void,
        holdsLane: () => false,
      },
    ),
    Context.add(TerminalWriters, input.writers ?? null),
  );
  return makeHostTerminals(input).pipe(Effect.provide(owners));
};

export const floorServices = (over: { readonly uses?: unknown; readonly environments?: unknown } = {}) =>
  Layer.mergeAll(
    Layer.succeed(RootUses, over.uses as RootUses['Service']),
    Layer.succeed(Environments, over.environments as Environments['Service']),
  );

export const terminalInventory = (...input: Parameters<typeof makeTerminalInventory>) => makeTerminalInventory(...input);

type ReconciliationFixture = {
  readonly installation: InstallationId;
  readonly executions: HostExecutions;
  readonly requestKeys: RequestKeys;
  readonly intents: TerminalIntents;
  readonly terminalRows: TerminalRows;
  readonly commandRows: CommandRows;
  readonly grants: TerminalGrants['Service'];
};

export const terminalReconciliation = (input: ReconciliationFixture) =>
  makeTerminalReconciliation(input).pipe(
    Effect.provide(
      hostServices(input.executions).pipe(
        Context.add(RequestKeys, input.requestKeys),
        Context.add(TerminalIntents, input.intents),
        Context.add(TerminalRows, input.terminalRows),
        Context.add(CommandRows, input.commandRows),
        Context.add(TerminalGrants, input.grants),
      ),
    ),
  );

export const executionTargets = () => makeTerminalTargets;

export const terminalThreads = (...input: Parameters<typeof makeTerminalThreads>) => makeTerminalThreads(...input);

export const leasedWorlds = (...input: Parameters<typeof makeLeasedWorlds>) => makeLeasedWorlds(...input);

export const terminalLanes = (...input: Parameters<typeof makeTerminalLanes>) => makeTerminalLanes(...input);

export const terminalWriters = ({ terminalRows, ...options }: { readonly terminalRows: TerminalRows; readonly everyMs?: number }) =>
  makeTerminalWriters(options).pipe(Effect.provideService(TerminalRows, terminalRows));

export const admittedGit = (...input: Parameters<typeof admittedGitFn>) => admittedGitFn(...input);

export const servingGit = (...input: Parameters<typeof makeServingGit>) => makeServingGit(...input);

export const resolveCommandPolicy = (...input: Parameters<typeof resolveCommandPolicyFn>) => resolveCommandPolicyFn(...input);

export const writeRule = (...input: Parameters<typeof writeRuleFn>) => writeRuleFn(...input);

export const removeRule = (...input: Parameters<typeof removeRuleFn>) => removeRuleFn(...input);

export const executionState = (...input: Parameters<typeof executionStateFn>) => executionStateFn(...input);

export const hostBundle = (...input: Parameters<typeof hostBundleFn>) => hostBundleFn(...input);

export const sweepKeyOf = (...input: Parameters<typeof sweepKeyOfFn>) => sweepKeyOfFn(...input);

export const terminalChannel = (...input: Parameters<typeof terminalChannelFn>) => terminalChannelFn(...input);

export const runRetention = (...input: Parameters<typeof runRetentionFn>) => runRetentionFn(...input);

export const checkoutWorld = (...input: Parameters<typeof checkoutWorldFn>) => checkoutWorldFn(...input);

export const checkoutWorldFor = (...input: Parameters<typeof checkoutWorldForFn>) => checkoutWorldForFn(...input);

export const makeMachineWorld = (...input: Parameters<typeof makeMachineWorldFn>) => makeMachineWorldFn(...input);

export const hostEnvironmentLayer = (...input: Parameters<typeof backendEnvironment>) => backendEnvironment(...input);

export const executionPolicy = () => policyValue;

export const executionWireLimits = () => wireLimitsValue;

export const COMMAND_RULE_PAIRS = () => rulePairs;

export const EXECUTION_SETTING_KEYS = () => settingKeys;

export const LANE_GRACE_MS = () => laneGraceMs;

export const RETAINED_OPERATION_KEYS = () => retainedKeys;

export const commandRule = () => commandRuleTable;

export const terminalRequestKey = () => terminalRequestKeyTable;

export const terminalIntent = () => terminalIntentTable;

export const terminal = () => terminalTable;

export const commandWait = () => commandWaitTable;

export const custodyNotice = () => custodyNoticeTable;

export const command = () => commandTable;

export const admitCommands = (admit: CommandAdmitter): CommandAdmitter => admit;

export const noAdopters = TerminalAdopters.of({ of: () => Effect.succeed(new Map()), moves: Stream.never });

export const watchedQueue = () => Queue.unbounded<TerminalWatched>();

export const setupCommands = setupCommandsImpl;

export const endHosts = endHostsImpl;
export const hostsUnder = hostsUnderImpl;
