import { Context, Data, Effect, Layer } from 'effect';
import type { NextInstallation } from '../installation/contract/service/next.js';
import type { ServerProcess, Succession } from '../installation/contract/service/succession.js';
import type { RpcGroup } from 'effect/rpc';
import { type LiveHandlers, liveLayer } from '../socket/live.js';
import type { Connections } from '../socket/connections.js';
import type { LiveGroup } from './rpc.js';
import type { FeedDeclaration } from '../platform/contract/wire/operation.js';
import { bindFeed, SocketOperations } from '../invocation/contract/service/socketOperations.js';
import type { FeedBody } from '../platform/contract/wire/live.js';
import { OperationId } from '../platform/contract/wire/ids.js';
import type { Assembly } from './manifest.js';
import type { CORE_MODULES } from './core.js';
import { sendingRoute } from './http/sending.js';
import { doorStep } from './http/answering.js';
import { Listenings } from '../speech/contract/service/listenings.js';
import { DesktopChannel } from '../desktop-browser/contract/service/channel.js';
import { desktopReportRoute } from '../desktop-browser/door.js';

export type LiveDoorOf<M> = M extends { readonly live: { readonly handlers: (door: Context.Context<infer R>) => unknown } } ? R : never;

export type SocketDoor = LiveDoorOf<(typeof CORE_MODULES)[number]>;
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

const liveHandlers = (
  { modules, feeds }: Assembly,
  door: Context.Context<SocketDoor>,
): Effect.Effect<LiveHandlers<RpcGroup.Rpcs<LiveGroup>>> =>
  Effect.map(
    Effect.forEach(modules, (module) => (module.live === undefined ? Effect.succeed({}) : module.live.handlers(door))),
    (declared) => {
      const own: Record<string, unknown> = Object.assign({}, ...declared);
      const handlers: Record<string, unknown> = {};
      const unhandled: string[] = [];
      for (const feed of feeds) {
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
      return handlers as LiveHandlers<RpcGroup.Rpcs<LiveGroup>>;
    },
  );

export const liveServing = (assembly: Assembly, connections: Connections | null) =>
  Layer.unwrap(
    Effect.flatMap(Effect.context<SocketDoor>(), (door) =>
      Effect.map(liveHandlers(assembly, door), (handlers) =>
        Layer.mergeAll(
          liveLayer(assembly.live, handlers, assembly.socketVerbs, connections, assembly.feeds),
          sendingRoute(Context.get(door, Listenings), connections),
          desktopReportRoute(Context.get(door, DesktopChannel)),
        ),
      ),
    ),
  );
