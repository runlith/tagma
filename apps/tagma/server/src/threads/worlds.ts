import { Context, Effect, Layer } from 'effect';
import { worldsLayer } from '../executions/ports.js';
import { CommandAccess } from '../executions/contract/service/access.js';
import { ManagedCommands } from '../executions/contract/service/commands.js';
import { Discharge } from '../executions/contract/service/discharge.js';
import { HostManagement } from '../executions/contract/service/host.js';
import { ExecutionProcessEvidence } from '../executions/contract/service/records.js';
import { TerminalTargets } from '../executions/contract/service/targets.js';
import { Terminals } from '../executions/contract/service/terminals.js';
import { TerminalWriting } from '../executions/contract/service/writing.js';
import { CommandLedger, MachineWorld, WorldPreferences, Worlds } from '../executions/contract/service/worlds.js';
import { GuestWorlds } from '../sandbox/contract/service/guests.js';
import { WorkingOrigins } from '../workspace/contract/service/places.js';
import { ScratchAreas } from './contract/service/scratch.js';

export const threadWorldsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const scratch = yield* ScratchAreas;
    const guests = yield* GuestWorlds;
    const origins = yield* WorkingOrigins;
    const preferences = yield* WorldPreferences;
    const machine = yield* MachineWorld;
    const ledger = yield* Effect.serviceOption(CommandLedger);
    const executions = Context.make(Terminals, yield* Terminals).pipe(
      Context.add(TerminalWriting, yield* TerminalWriting),
      Context.add(ExecutionProcessEvidence, yield* ExecutionProcessEvidence),
      Context.add(Discharge, yield* Discharge),
      Context.add(ManagedCommands, yield* ManagedCommands),
      Context.add(TerminalTargets, yield* TerminalTargets),
      Context.add(HostManagement, yield* HostManagement),
      Context.add(CommandAccess, yield* CommandAccess),
    );
    return worldsLayer({
      executions,
      preferences,
      scratch: (threadId) => scratch.scope(threadId).path,
      world: machine.world,
      commands: ledger._tag === 'Some' ? ledger.value.of : undefined,
      hosts: [guests.worldHost()],
      place: (root) => origins.placeOf(root),
    });
  }),
) satisfies Layer.Layer<
  Worlds,
  never,
  | ScratchAreas
  | GuestWorlds
  | WorkingOrigins
  | WorldPreferences
  | MachineWorld
  | Terminals
  | TerminalWriting
  | ExecutionProcessEvidence
  | Discharge
  | ManagedCommands
  | TerminalTargets
  | HostManagement
  | CommandAccess
>;
