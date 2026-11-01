import { Context, Effect, Layer } from 'effect';
import type { Commands, World } from '@runlith/agent-tools/world';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { MachineUnits } from '../platform/contract/service/units.js';
import type { StoreFailure } from '../platform/contract/service/store.js';
import type { ProvedRoot } from '../workspace/contract/wire/place.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import type { ExecutionServices } from './assembly.js';
import type { TerminalRecord } from './contract/wire/terminals.js';
import { CommandAccess, TerminalAccess } from './contract/service/access.js';
import { CommandReader, ManagedCommands } from './contract/service/commands.js';
import { TerminalAdopters } from './contract/service/adopters.js';
import { Custody } from './contract/service/custody.js';
import { Discharge } from './contract/service/discharge.js';
import { HostManagement } from './contract/service/host.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from './contract/service/records.js';
import { TerminalRequests, Terminals } from './contract/service/terminals.js';
import { TerminalTargets } from './contract/service/targets.js';
import { TerminalGrids, ViewLanes, ViewLeases } from './contract/service/views.js';
import { TerminalWriting } from './contract/service/writing.js';
import type { LedgerKey, WorldHost, WorldPreferences } from './contract/service/worlds.js';
import { Worlds } from './contract/service/worlds.js';
import { commandBytesChannel } from './commands/bytesChannel.js';
import { commandChannel } from './commands/channel.js';
import { LoadFeed } from './contract/service/load.js';
import type { ExecutionLiveDoor } from './contract/service/live.js';
import { loadChannel } from './load/channel.js';
import { endHeldCommands } from './commands/endHeld.js';
import { setupCommands } from './commands/setup.js';
import { terminalProgramRoad } from './commands/programRoad.js';
import { terminalChannel } from './terminals/channel.js';
import { endHeldExecutions, type LaunchedExecution } from './terminals/endHeld.js';
import { rootExecutions } from './terminals/rootExecutions.js';
import { makeLeasedWorlds } from './worlds/cache.js';
import { commandLedgerLayer } from './worlds/commandLedger.js';
import { checkoutWorldFor } from './worlds/managed.js';
import { hostEnvironment } from './host/environmentBackend.js';
import { makeMachineWorld } from './worlds/machine.js';

type Standing = Context.Context<ExecutionServices>;

const SETUP_SHELL = '/bin/sh';

export type WorldServices =
  | Terminals
  | TerminalWriting
  | ExecutionProcessEvidence
  | Discharge
  | ManagedCommands
  | TerminalTargets
  | HostManagement
  | CommandAccess;

export const executionWorlds = Effect.fnUntraced(function* (input: {
  readonly executions: Context.Context<WorldServices>;
  readonly preferences: WorldPreferences['Service'];
  readonly scratch: (threadId: string) => string;
  readonly world: World;
  readonly commands?: (subject: LedgerKey) => Commands;
  readonly hosts: readonly WorldHost[];
  readonly place: (root: string) => Effect.Effect<ProvedRoot | null>;
}) {
  return yield* makeLeasedWorlds({
    checkout: (thread, root, projectId, runId, lease) =>
      checkoutWorldFor(thread, root, projectId, runId, lease, {
        preferences: input.preferences,
        terminals: Context.get(input.executions, Terminals),
        writing: Context.get(input.executions, TerminalWriting),
        evidence: Context.get(input.executions, ExecutionProcessEvidence),
        discharge: Context.get(input.executions, Discharge),
        managed: Context.get(input.executions, ManagedCommands),
        targets: Context.get(input.executions, TerminalTargets),
        host: Context.get(input.executions, HostManagement).connection,
        successor: Context.get(input.executions, HostManagement).successor,
        access: Context.get(input.executions, CommandAccess),
        scratch: input.scratch,
        world: input.world,
        commands: input.commands,
      }),
    hosts: input.hosts,
    place: input.place,
  });
});

export const worldsLayer = (...input: Parameters<typeof executionWorlds>): Layer.Layer<Worlds> =>
  Layer.effect(Worlds, executionWorlds(...input));

export const worktreeSetup = (executions: Standing) =>
  setupCommands(
    {
      terminals: Context.get(executions, Terminals),
      commands: Context.get(executions, ManagedCommands),
      access: Context.get(executions, CommandAccess),
      targets: Context.get(executions, TerminalTargets),
    },
    SETUP_SHELL,
  );

export const worktreeRootEnding = (executions: Standing, units: MachineUnits['Service']) =>
  rootExecutions({
    holding: (projectId, useIds) => units.read((unit) => Context.get(executions, Custody).holdingUses(unit, projectId, useIds)),
    access: Context.get(executions, TerminalAccess),
    commands: {
      prepare: (request) => Context.get(executions, CommandAccess).prepare(request),
      recheck: (unit, prepared) => Context.get(executions, CommandAccess).recheck(unit, prepared),
    },
    ended: (projectId, execution) => Context.get(executions, Discharge).ended(projectId, execution, true),
    key: (projectId, operationId) =>
      Effect.map(Context.get(executions, TerminalRequests).request(projectId, operationId), (state) =>
        state._tag === 'Unknown'
          ? 'free'
          : state._tag === 'Expired' || (state._tag === 'Settled' && state.execution === undefined)
            ? 'unsent'
            : 'sent',
      ),
    stop: (key, record) =>
      Context.get(executions, Terminals).stop(record.projectId, key, record.execution, record.revision, 'explicit-stop', 'signal'),
    stopCommand: (key, record, authority) =>
      Context.get(executions, ManagedCommands).stop(record.projectId, key, record.execution, authority, 'explicit-stop', 'signal'),
  });

export type HeldServices = Custody | Discharge | Terminals | ManagedCommands | CommandAccess;

export const threadEndHeld = (input: {
  readonly executions: Context.Context<HeldServices>;
  readonly units: MachineUnits['Service'];
  readonly named: (launched: LaunchedExecution) => Effect.Effect<TerminalRecord | null, unknown>;
}) => ({
  executions: endHeldExecutions({
    heldBy: (threadIds: readonly ThreadId[]) => input.units.read((unit) => Context.get(input.executions, Custody).heldBy(unit, threadIds)),
    named: input.named,
    ended: (record) => Context.get(input.executions, Discharge).ended(record.projectId, record.execution),
    stop: (key, record) =>
      Context.get(input.executions, Terminals).stop(record.projectId, key, record.execution, record.revision, 'explicit-stop', 'signal'),
  }),
  commands: (asked: {
    readonly projectId: number;
    readonly threadIds: readonly string[];
    readonly run?: string;
    readonly cause: CancellationCause;
    readonly operation: HostRequestKey;
  }) => endHeldCommands(Context.get(input.executions, ManagedCommands), Context.get(input.executions, CommandAccess))(asked),
});

export const executionChannels = (input: { readonly executions: Context.Context<ExecutionLiveDoor> }) => {
  const viewers = Context.get(input.executions, ViewLeases);
  const records = Context.get(input.executions, ExecutionRecords);
  return {
    terminal: terminalChannel({
      terminals: Context.get(input.executions, Terminals),
      screens: Context.get(input.executions, TerminalScreens),
      records,
      viewers,
      lanes: Context.get(input.executions, ViewLanes),
      grids: Context.get(input.executions, TerminalGrids),
    }),
    command: commandChannel({
      feeds: Context.get(input.executions, CommandReader),
      adopters: Context.get(input.executions, TerminalAdopters),
    }),
    load: loadChannel(Context.get(input.executions, LoadFeed)),
    commandBytes: commandBytesChannel({
      reader: Context.get(input.executions, CommandReader),
      access: Context.get(input.executions, CommandAccess),
      records,
      viewers,
    }),
  };
};

export const programRoadOver = (executions: Standing, shell: string) =>
  terminalProgramRoad(
    Context.get(executions, Terminals),
    Context.get(executions, ManagedCommands),
    Context.get(executions, CommandAccess),
    Context.get(executions, TerminalTargets),
    shell,
  );

export const commandLedger = (options: { readonly instanceId: string }) => commandLedgerLayer(options);

export const machineWorld = (carriedRipgrep: () => string | null) => makeMachineWorld(carriedRipgrep);

export const hostBackend = (world: World) => hostEnvironment(world);
