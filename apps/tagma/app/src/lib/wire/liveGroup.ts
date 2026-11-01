import type { WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { liveGroupOf, type RpcOfFeed } from '@tagma/server/platform/contract/wire/live';
import type { Point } from '@runlith/layer/Point';
import type { RpcGroup } from 'effect/rpc';

export interface Feeds {}

export type LiveRpcs = RpcOfFeed<Feeds[keyof Feeds]>;

export type LiveGroup = RpcGroup.RpcGroup<LiveRpcs>;

export const liveGroupFrom = (catalog: Point<WireModule>): (() => LiveGroup) =>
  catalog.derive((modules) => liveGroupOf(modules) as unknown as LiveGroup);
