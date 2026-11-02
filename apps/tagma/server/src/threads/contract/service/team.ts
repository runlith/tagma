import type { ReviewPolicy, Team, TeamEdit, TeamLayer } from '@runlith/agent/collaboration/team';
import type { TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { NotInstalled } from '../../../providers/contract/service/registry.js';
import type { ConnectedProviders } from '../../../providers/contract/service/accounts.js';
import type { SettingWriteRefusal } from '../../../settings/contract/service/values.js';
import type { TeamLineage } from '../../mandate.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';

export type TeamLayers = {
  readonly edits: readonly TeamEdit[];
  readonly review: ReviewPolicy;
  readonly thread: TeamLineage;
  readonly connected: ConnectedProviders;
};

export type TeamPlace = {
  readonly threadId: string | null;
  readonly projectId: number | undefined;
  readonly runId?: string;
  readonly copy?: TeamLayer;
};

export type TeamPromotion = {
  readonly promoted: TeamLayer | null;
  readonly previous: { readonly models: readonly TeamEdit[] | null; readonly review: ReviewPolicy | null };
};

export class ThreadTeams extends Context.Service<
  ThreadTeams,
  {
    layers(place: TeamPlace): Effect.Effect<TeamLayers, StoreFailure | TokenStoreFault | NotInstalled>;
    of(place: TeamPlace, layers?: TeamLayers): Effect.Effect<Team, StoreFailure | TokenStoreFault | NotInstalled>;
    set(threadId: string, team: TeamLayer | null): Effect.Effect<TeamLineage, StoreFailure>;
    inherit(threadId: string, source: TeamPlace, unit: WriteUnit<'machine'>): Effect.Effect<void, StoreFailure>;
    promote(threadId: string, projectId: number): Effect.Effect<TeamPromotion, StoreFailure | GateRefusal<SettingWriteRefusal>>;
    adopt(team: TeamLayer, projectId: number): Effect.Effect<TeamPromotion, StoreFailure | GateRefusal<SettingWriteRefusal>>;
  }
>()('tagma/threads/ThreadTeams') {}
