import type { Table } from 'drizzle-orm';
import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { MachineStore, StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export type HomeMove = { readonly threadId: string; readonly from: number; readonly to: number };

export type HomeFollowing = {
  readonly tables: readonly Table[];
  readonly admit?: (unit: WriteUnit<'machine'>, move: HomeMove) => Effect.Effect<void, StoreFailure | GateRefusal, MachineStore>;
  readonly follow: (unit: WriteUnit<'machine'>, move: HomeMove) => Effect.Effect<void, StoreFailure, MachineStore>;
};

export type HomeFollower = {
  readonly id: string;
  readonly load: () => Promise<HomeFollowing>;
};

export const HOME_FOLLOWERS = new ContributionPoint<HomeFollower>('thread-record/home-followers');

export class HomeFollowers extends Context.Service<HomeFollowers, { readonly all: readonly HomeFollowing[] }>()(
  'tagma/thread-record/HomeFollowers',
) {}
