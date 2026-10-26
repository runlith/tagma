import type { TeamLayer } from '@runlith/agent/collaboration/team';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { ApprovesLineage, DelegationLineage, TeamLineage } from '../../mandate.js';

export class ThreadMandate extends Context.Service<
  ThreadMandate,
  {
    delegationLineage(id: string): Effect.Effect<DelegationLineage, StoreFailure>;
    setDelegation(id: string, delegation: boolean | null): Effect.Effect<void, StoreFailure>;
    approvesLineage(id: string): Effect.Effect<ApprovesLineage, StoreFailure>;
    setApproves(id: string, approves: readonly string[] | null): Effect.Effect<void, StoreFailure>;
    teamLineage(id: string): Effect.Effect<TeamLineage, StoreFailure>;
    setTeam(id: string, team: TeamLayer | null): Effect.Effect<void, StoreFailure>;
    takenOver(id: string): Effect.Effect<boolean, StoreFailure>;
    setTakenOver(id: string, takenOver: boolean): Effect.Effect<void, StoreFailure>;
    operatorNotice(id: string): Effect.Effect<boolean | null, StoreFailure>;
    setOperatorNotice(id: string, notice: boolean | null): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/threads/ThreadMandate') {}
