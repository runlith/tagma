import { Context, Effect, Queue } from 'effect';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import type { TerminalWatched } from '../contract/service/endings.js';
import { Custody, type TerminalDisplaced } from '../contract/service/custody.js';
import { Discharge, type Dischargers } from '../contract/service/discharge.js';
import { ExecutionHost } from '../contract/service/host.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from '../contract/service/records.js';
import { ManagedCommands } from '../contract/service/commands.js';
import { TerminalRequests, Terminals } from '../contract/service/terminals.js';
import { TerminalWriting } from '../contract/service/writing.js';
import { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import { makeExecutionGate } from './acts.js';
import { makeTerminalStart } from './start.js';
import { makeTerminalReads } from './reads.js';
import { makeTerminalWriting } from './input.js';
import { makeTerminalCustody } from './custody.js';
import { makeTerminalStops } from './stops.js';
import { makeCommandActs } from '../commands/acts.js';
import { makeTerminalDischarge } from './discharge.js';
import { makeStopDispatches } from './refs.js';

export const UNVERSIONED = 'unversioned';

export type HostTerminals = Terminals['Service'] &
  TerminalRequests['Service'] &
  TerminalWriting['Service'] &
  Custody['Service'] &
  ExecutionRecords['Service'] &
  TerminalScreens['Service'] &
  ExecutionProcessEvidence['Service'] &
  ExecutionHost['Service'] &
  Dischargers & { readonly commands: ManagedCommands['Service'] };

export const makeHostTerminals = Effect.fnUntraced(function* ({
  installation,
  programVersion = UNVERSIONED,
  watched: givenWatched,
  displaced: givenDisplaced,
  ready = Effect.void,
}: {
  readonly installation: InstallationId;
  readonly programVersion?: string;
  readonly watched?: Queue.Enqueue<TerminalWatched>;
  readonly displaced?: Queue.Queue<TerminalDisplaced>;
  readonly ready?: Effect.Effect<void>;
}): Effect.fn.Return<
  HostTerminals,
  never,
  | Effect.Services<ReturnType<typeof makeTerminalReads>>
  | Effect.Services<ReturnType<typeof makeTerminalWriting>>
  | Effect.Services<ReturnType<typeof makeTerminalCustody>>
  | Effect.Services<ReturnType<typeof makeTerminalDischarge>>
  | Exclude<Effect.Services<ReturnType<typeof makeTerminalStart>>, TerminalWriting>
  | Exclude<Effect.Services<ReturnType<typeof makeTerminalStops>>, Discharge>
  | Exclude<Effect.Services<ReturnType<typeof makeCommandActs>>, Terminals | ExecutionRecords>
  | ExecutionEvidence
> {
  const gate = makeExecutionGate();
  const watched = givenWatched ?? (yield* Effect.acquireRelease(Queue.unbounded<TerminalWatched>(), Queue.shutdown));
  const displaced = givenDisplaced ?? (yield* Effect.acquireRelease(Queue.unbounded<TerminalDisplaced>(), Queue.shutdown));
  const dispatches = makeStopDispatches();
  const reading = yield* makeTerminalReads({ installation, dispatches });
  const writing = yield* makeTerminalWriting({ installation, gate });
  const releasing = yield* makeTerminalDischarge({ installation });
  const discharge = Discharge.of(releasing);
  const custody = yield* makeTerminalCustody({ installation, gate, displaced });
  const starts = yield* makeTerminalStart({ installation, programVersion, watched, ready }).pipe(
    Effect.provideService(TerminalWriting, writing),
  );
  const stops = yield* makeTerminalStops({ installation, dispatches }).pipe(Effect.provideService(Discharge, discharge));
  const evidence = yield* ExecutionEvidence;
  const terminals = Terminals.of({
    ...starts,
    record: reading.record,
    recordsOf: reading.recordsOf,
    shell: reading.shell,
    state: custody.state,
    wait: custody.wait,
    signal: stops.signal,
    stop: stops.stop,
    stopAsked: reading.stopAsked,
    lost: reading.lost,
    inventory: reading.inventory,
  });
  const records = ExecutionRecords.of({ bytes: reading.bytes, records: reading.records });
  const acts = yield* makeCommandActs({ installation }).pipe(
    Effect.provide(Context.make(Terminals, terminals).pipe(Context.add(ExecutionRecords, records))),
  );
  const commands = ManagedCommands.of({
    ...acts,
    record: reading.commandRecord,
    startedBy: reading.commandStartedBy,
    stop: stops.stopCommand,
    stopAll: stops.stopCommands,
    changes: stops.commandChanges,
    moves: stops.commandMoves,
  });
  return {
    ...terminals,
    ...TerminalRequests.of({ request: reading.operation, requestFor: reading.operationFor, retention: reading.keyRetention }),
    ...writing,
    ...Custody.of({
      ...custody,
      displaced,
      disown: releasing.disown,
      disownThreads: releasing.disownThreads,
      disownProject: releasing.disownProject,
      disownGone: releasing.disownGone,
    }),
    ...records,
    ...TerminalScreens.of({ screen: reading.screen, point: reading.point, screens: reading.screens, settled: reading.settled }),
    ...ExecutionProcessEvidence.of({
      foreground: evidence.foreground,
      processes: stops.processes,
      ports: stops.ports,
      load: evidence.load,
    }),
    ...ExecutionHost.of({ ledger: reading.ledger, offersCommands: reading.offersCommands }),
    ...discharge,
    commands,
  };
});
