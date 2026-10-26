import { type Rpc, RpcGroup } from 'effect/rpc';
import { CallLog } from '../socket/rpc.js';
import { rpcOf, type RpcOfFeed } from '../platform/contract/wire/live.js';
import { COLLECTED_FEEDS, type LiveFeed } from './manifest.js';

export type LiveRpcs = RpcOfFeed<LiveFeed>;

export const LiveRpc: RpcGroup.RpcGroup<Rpc.AddMiddleware<LiveRpcs, typeof CallLog>> = RpcGroup.make(
  ...COLLECTED_FEEDS.map(rpcOf),
).middleware(CallLog);
