import type { ThreadModelSelection } from '@runlith/agent/thread/record';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadCreateInput } from '@runlith/agent/thread/ThreadAggregate';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { BirthConflict, BirthInput, BirthRefused } from '@runlith/agent/collaboration/threads';
import { Context, Data, type Effect, type Stream } from 'effect';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ProgramState } from '../../../providers/contract/service/cli.js';
import type { MachineStore, StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { HarnessId } from '../../../platform/contract/wire/session.js';
import type { ThreadListRow } from '../wire/list.js';
import type { ExternalSession, HarnessInstall } from '../wire/harness/externalSession.js';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { HarnessSeat, SeatChoice, SeatedHarness } from '../wire/harness/seat.js';
import type { ModelPick } from '../wire/harness/pick.js';
import type { NativeThreadSnapshot } from './state.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { CarriedRecord, RolloutPart } from '../../journal/rolloutMeta.js';
import type { HarnessFailure } from './failure.js';

export class HarnessMissing extends Data.TaggedError('HarnessMissing')<{ readonly harness: string }> {}

export type HarnessNotInstalled = GateRefusal<'harness-not-installed'>;

export const harnessNotInstalled = (harness: string, install: string | null = null): HarnessNotInstalled =>
  new GateRefusal('harness-not-installed', `No plugin on this machine declares the ${harness} harness.`, [
    install ?? `install_plugin the plugin that brings ${harness}`,
    'continue on a harness or model this machine has',
  ]);

export class HarnessFaceMissing extends Data.TaggedError('HarnessFaceMissing')<{
  readonly harness: string;
  readonly face: string;
}> {}

export type HarnessSpent = { readonly tokens: number; readonly unmeasured: readonly string[] };
export type HarnessServes = {
  readonly provider: string;
  seat(to: SeatChoice, agent: string): Effect.Effect<SeatedHarness, HarnessFailure>;
};
export type HarnessSeating = {
  readonly name: HarnessId;
  seat(agent: string): Effect.Effect<SeatedHarness, HarnessFailure>;
};
export type HarnessSeated = { readonly name: HarnessId; readonly seat: SeatedHarness };
export type HarnessMoveTo = ThreadModelSelection & {
  readonly account?: string | null;
  readonly switches?: ModelSwitches;
  readonly pending?: string;
};
export type HarnessMoved = { readonly from: ThreadModelSelection | null; readonly to: ThreadModelSelection };
export type HarnessFollowed = HarnessMoved & { readonly left: string | null };

export class Harness extends Context.Service<
  Harness,
  {
    born<T>(
      request: ThreadCreateInput,
      within: (thread: ThreadRow, unit: WriteUnit<'machine'>) => Effect.Effect<T, ThreadBorderFailed>,
    ): Effect.Effect<T, ThreadBorderFailed>;
    recover(): Effect.Effect<void, HarnessFailure>;
    retract<E>(
      threadId: string,
      signalId: string,
      within: (unit: WriteUnit<'machine'>) => Effect.Effect<void, E>,
    ): Effect.Effect<void, ThreadBorderFailed>;
    folded(threadId: string, records: readonly CarriedRecord[]): Effect.Effect<void, StoreFailure, MachineStore>;
    readonly record: RolloutPart;
    row(threadId: string): Effect.Effect<ThreadListRow['harness'], HarnessFailure>;
    models(
      requested: Partial<ThreadModelSelection>,
    ): Effect.Effect<Partial<ThreadModelSelection> | undefined, HarnessFailure | HarnessFaceMissing>;
    readonly move?: (threadId: string, to: HarnessMoveTo) => Effect.Effect<HarnessMoved, HarnessFailure>;
    readonly release?: (threadId: string, unit: WriteUnit<'machine'>) => Effect.Effect<void, StoreFailure>;
    spent(spawnRootId: string, principal: string): Effect.Effect<HarnessSpent, HarnessFailure | HarnessFaceMissing>;
    readonly birthWrites?: WriteSet;
    readonly seat?: (source: string, unit: WriteUnit<'machine'>) => Effect.Effect<HarnessSeat, HarnessFailure>;
    readonly transportAt?: (projectId: number, preferred: ThreadModelSelection | null) => Effect.Effect<HarnessSeat, HarnessFailure>;
    readonly serves?: HarnessServes;
    readonly spawn?: (
      input: BirthInput,
    ) => Effect.Effect<{ readonly threadId: string; readonly acted: boolean }, HarnessFailure | BirthConflict | BirthRefused>;
    readonly readerWords?: (threadId: string) => Effect.Effect<readonly string[], StoreFailure | GateRefusal>;
    readonly provider?: string;
  }
>()('tagma/threads/Harness') {}

export class HarnessRegistry extends Context.Service<
  HarnessRegistry,
  {
    register(harness: HarnessId, bound: Harness['Service']): Effect.Effect<void>;
    replace(harness: HarnessId, bound: Harness['Service']): Effect.Effect<void>;
    withdraw(harness: HarnessId): Effect.Effect<void>;
    resolve(harness: HarnessId): Effect.Effect<Harness['Service'], HarnessMissing>;
    list(): readonly HarnessId[];
    writes(base: WriteSet): WriteSet;
    seating(to: SeatChoice, models: ModelCatalog): Effect.Effect<HarnessSeating | null, HarnessFailure>;
  }
>()('tagma/threads/HarnessRegistry') {}

export class HarnessMoves extends Context.Service<
  HarnessMoves,
  {
    move(threadId: string, to: HarnessMoveTo): Effect.Effect<HarnessMoved | null, HarnessFailure>;
    pick(threadId: string, pick: ModelPick): Effect.Effect<NativeThreadSnapshot, HarnessFailure>;
    lagging(provider: string, account: string): Effect.Effect<readonly string[], StoreFailure>;
    follow(threadId: string, provider: string, account: string | null): Effect.Effect<HarnessFollowed | null, HarnessFailure>;
  }
>()('tagma/threads/HarnessMoves') {}

export class InstalledHarnesses extends Context.Service<
  InstalledHarnesses,
  {
    readonly read: Effect.Effect<readonly HarnessInstall[]>;
    readonly settled: Effect.Effect<readonly HarnessInstall[]>;
    readonly refresh: Effect.Effect<readonly HarnessInstall[]>;
    program(name: string, by?: 'binary' | 'harness'): Effect.Effect<HarnessProgram | null>;
    locate(name: string): Effect.Effect<HarnessProgram | null>;
    availability(binary: string): Effect.Effect<ProgramState>;
    readonly changes: Stream.Stream<void>;
  }
>()('tagma/threads/InstalledHarnesses') {}

export type HarnessProgram = { readonly path: string; readonly runtime: string | null };

export class SessionRead extends Context.Service<
  SessionRead,
  (threadId: string, unit?: Unit<'machine'>) => Effect.Effect<ExternalSession | null, StoreFailure | GateRefusal>
>()('tagma/threads/SessionRead') {}
