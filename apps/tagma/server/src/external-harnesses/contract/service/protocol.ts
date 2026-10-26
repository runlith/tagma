import { Context, type Effect } from 'effect';
import type { TransportAsks, TransportRuns } from '@runlith/agent/thread/transport/contract';
import type { ProtocolState } from '../wire/protocolState.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { HarnessSeat } from '../../../threads/contract/wire/harness/seat.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export type ProtocolSessions = {
  readonly writes: WriteSet;
  readonly seat: (source: string, unit: WriteUnit<'machine'>) => Effect.Effect<HarnessSeat, HarnessFailure>;
  readonly asks: TransportAsks;
  readonly runs: TransportRuns;
  readonly release: (threadId: string, unit: WriteUnit<'machine'>) => Effect.Effect<void, StoreFailure>;
};

export class ProtocolStates extends Context.Service<
  ProtocolStates,
  {
    read(threadId: string, projectId: number): Effect.Effect<ProtocolState, HarnessFailure>;
  }
>()('tagma/external-harnesses/ProtocolStates') {}
