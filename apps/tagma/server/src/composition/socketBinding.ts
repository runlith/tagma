import { Context, Data, Effect, Layer } from 'effect';
import type { NextInstallation } from '../installation/contract/service/next.js';
import type { ServerProcess, Succession } from '../installation/contract/service/succession.js';
import type { RpcGroup } from 'effect/rpc';
import { type LiveHandlers, liveLayer } from '../socket/live.js';
import type { Connections } from '../socket/connections.js';
import { LiveRpc } from './rpc.js';
import type { FeedDeclaration } from '../platform/contract/wire/operation.js';
import { bindFeed, SocketOperations } from '../invocation/contract/service/socketOperations.js';
import type { FeedBody } from '../platform/contract/wire/live.js';
import { OperationId } from '../platform/contract/wire/ids.js';
import { COLLECTED_FEEDS } from './manifest.js';
import { MODULES } from '@tagma/server/composition/modules';
import { sendingRoute } from './http/sending.js';
import { doorStep } from './http/answering.js';
import { Listenings } from '../speech/contract/service/listenings.js';
import { DesktopChannel } from '../desktop-browser/contract/service/channel.js';
import { desktopReportRoute } from '../desktop-browser/door.js';

const FEEDS: readonly FeedDeclaration[] = COLLECTED_FEEDS;

export const SOCKET_VERBS: Readonly<Record<string, OperationId>> = Object.fromEntries(
  FEEDS.flatMap((declared) => (declared.performs === undefined ? [] : [[declared.id, OperationId.make(declared.performs)] as const])),
);

type LiveDoorOf<M> = M extends { readonly live: { readonly handlers: (door: Context.Context<infer R>) => unknown } } ? R : never;

export type SocketDoor = LiveDoorOf<(typeof MODULES)[number]>;
export type RuntimeSocketDoor = Exclude<SocketDoor, NextInstallation | Succession | ServerProcess>;

const performing = (declared: FeedDeclaration) => {
  const id = OperationId.make(declared.performs!);
  const answer = declared.answer ?? ((value: unknown) => value);
  const answered = doorStep(`live ${declared.id}`);
  return ({
    projectId,
    threadId,
    params,
  }: {
    readonly projectId: number;
    readonly threadId: string;
    readonly params?: object | undefined;
  }) =>
    Effect.flatMap(
      Effect.flatMap(SocketOperations, (operations) => operations.perform(id, projectId, { threadId, ...params }, declared)),
      (value) => answered(Effect.sync(() => answer(value))),
    );
};

export class LiveHandlersUnmatched extends Data.TaggedError('LiveHandlersUnmatched')<{
  readonly unhandled: readonly string[];
  readonly undeclared: readonly string[];
}> {
  override get message(): string {
    return `live verbs declared with no handler (${this.unhandled.join(', ')}), handlers with no declared verb (${this.undeclared.join(', ')})`;
  }
}

const liveHandlers = (door: Context.Context<SocketDoor>): Effect.Effect<LiveHandlers<RpcGroup.Rpcs<typeof LiveRpc>>> =>
  Effect.map(
    Effect.forEach(MODULES, (module) => ('live' in module ? module.live.handlers(door) : Effect.succeed({}))),
    (declared) => {
      const own: Record<string, unknown> = Object.assign({}, ...declared);
      const handlers: Record<string, unknown> = {};
      const unhandled: string[] = [];
      for (const feed of FEEDS) {
        if (feed.performs !== undefined) {
          handlers[feed.id] = performing(feed);
          continue;
        }
        const handler = own[feed.id] as FeedBody | undefined;
        if (handler === undefined) unhandled.push(feed.id);
        else handlers[feed.id] = bindFeed(feed, handler);
      }
      const undeclared = Object.keys(own).filter((verb) => !(verb in handlers));
      if (unhandled.length > 0 || undeclared.length > 0) throw new LiveHandlersUnmatched({ unhandled, undeclared });
      return handlers as LiveHandlers<RpcGroup.Rpcs<typeof LiveRpc>>;
    },
  );

export const liveServing = (connections: Connections | null) =>
  Layer.unwrap(
    Effect.flatMap(Effect.context<SocketDoor>(), (door) =>
      Effect.map(liveHandlers(door), (handlers) =>
        Layer.mergeAll(
          liveLayer(LiveRpc, handlers, SOCKET_VERBS, connections, FEEDS),
          sendingRoute(Context.get(door, Listenings), connections),
          desktopReportRoute(Context.get(door, DesktopChannel)),
        ),
      ),
    ),
  );
