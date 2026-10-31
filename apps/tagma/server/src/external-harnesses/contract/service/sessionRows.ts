import { Context, type Effect } from 'effect';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { TransportBinding, TransportCapabilities } from '@runlith/agent/thread/record';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import type { HarnessAskedModel } from '../../../threads/contract/wire/harness/askedModel.js';
import type { HarnessRoad } from '../../../threads/contract/wire/harness/seat.js';
import type { HarnessTransport } from '../../../threads/contract/wire/harness/names.js';

export type StandingSession = { readonly threadId: string; readonly facet: ExternalSession; readonly running: boolean };

export class SessionRows extends Context.Service<
  SessionRows,
  {
    inspect<A, E>(work: (unit: Unit<'machine'>) => Effect.Effect<A, E>): Effect.Effect<A, E | StoreFailure>;
    within<A, E>(
      operation: WriteSet | string,
      work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>,
    ): Effect.Effect<A, E | HarnessFailure>;
    planned<A, E>(
      operation: WriteSet,
      identity: string,
      work: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>,
    ): Effect.Effect<A | null, E | HarnessFailure>;
    held(threadId: string, facet: ExternalSession, unit: WriteUnit<'machine'>): Effect.Effect<void, HarnessFailure>;
    readonly writes: WriteSet;
    readonly choosing: WriteSet;
    read(threadId: string, unit: Unit<'machine'>): Effect.Effect<ExternalSession | null, StoreFailure | GateRefusal>;
    write(threadId: string, facet: ExternalSession, unit: WriteUnit<'machine'>): Effect.Effect<void, HarnessFailure>;
    sessionsStanding(transport: HarnessTransport): Effect.Effect<readonly StandingSession[], HarnessFailure>;
    standing(transport: HarnessTransport): Effect.Effect<readonly string[], HarnessFailure>;
    parked(runIds: readonly string[]): Effect.Effect<boolean, HarnessFailure>;
    ended(runIds: readonly string[]): Effect.Effect<boolean, HarnessFailure>;
    activeAt(threadId: string): Effect.Effect<number, HarnessFailure>;
    beat(ownerId: string, transport: HarnessTransport, active: readonly string[]): Effect.Effect<readonly string[], HarnessFailure>;
    asked(threadId: string, unit: Unit<'machine'>): Effect.Effect<HarnessAskedModel | undefined, StoreFailure>;
    ranOn(runId: string): Effect.Effect<HarnessAskedModel | undefined, StoreFailure>;
    threadOfRun(runId: string): Effect.Effect<string | null, StoreFailure>;
    road(threadId: string): Effect.Effect<HarnessRoad, StoreFailure>;
    choose(
      threadId: string,
      asked: HarnessAskedModel | undefined,
      switches: ModelSwitches | undefined,
      account: string | null | undefined,
      unit: WriteUnit<'machine'>,
    ): Effect.Effect<void, HarnessFailure>;
    switches(threadId: string, unit: Unit<'machine'>): Effect.Effect<ModelSwitches, StoreFailure>;
    capabilities(threadId: string): Effect.Effect<TransportCapabilities | undefined, StoreFailure>;
    binding(threadId: string, unit: Unit<'machine'>): Effect.Effect<TransportBinding | undefined, StoreFailure>;
  }
>()('external-harnesses/SessionRows') {}
