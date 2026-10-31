import { type Rpc, RpcGroup } from 'effect/rpc';
import { CallLog } from '../socket/rpc.js';
import { rpcOf, type RpcOfFeed } from '../platform/contract/wire/live.js';
import type { FeedDeclaration } from '../platform/contract/wire/operation.js';
import type { LiveFeed } from './manifest.js';

export type LiveRpcs = RpcOfFeed<LiveFeed>;

export type LiveGroup = RpcGroup.RpcGroup<Rpc.AddMiddleware<LiveRpcs, typeof CallLog>>;

export const liveRpc = (feeds: readonly FeedDeclaration[]): LiveGroup =>
  RpcGroup.make(...feeds.map(rpcOf)).middleware(CallLog) as unknown as LiveGroup;
