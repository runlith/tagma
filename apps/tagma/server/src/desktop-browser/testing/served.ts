import * as BunHttpServer from '@effect/platform-bun/BunHttpServer';
import { Context, Effect, Layer } from 'effect';
import { HttpRouter, HttpServer } from 'effect/http';
import { RpcGroup } from 'effect/rpc';
import { bindFeed, SocketOperations } from '../../invocation/contract/service/socketOperations.js';
import { type FeedBody, rpcOf } from '../../platform/contract/wire/live.js';
import { type LiveHandlers, liveLayer } from '../../socket/live.js';
import { CallLog } from '../../socket/rpc.js';
import { makeDesktopChannel } from '../channel.js';
import { DesktopChannel } from '../contract/service/channel.js';
import { ATTACH_FEED } from '../contract/wire/channel.js';
import { desktopBrowser } from '../desktop-browser.js';
import { desktopReportRoute } from '../door.js';

export class ServedChannel extends Context.Service<ServedChannel, { readonly url: URL }>()('tagma/desktop-browser/ServedChannel') {}

const group = RpcGroup.make(rpcOf(ATTACH_FEED)).middleware(CallLog);

const admitted = Layer.succeed(
  SocketOperations,
  SocketOperations.of({
    perform: () => Effect.die('the desktop channel serves a feed, not an operation'),
    admitFeed: () => Effect.void,
  }),
);

export const servedChannelOn = (port: number) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const made = yield* makeDesktopChannel;
      const channel = Context.get(made, DesktopChannel);
      const declared = yield* desktopBrowser.live.handlers(Context.make(DesktopChannel, channel));
      const handlers = {
        attach_browser_host: bindFeed(ATTACH_FEED, declared.attach_browser_host as FeedBody),
      } as LiveHandlers<RpcGroup.Rpcs<typeof group>>;
      const served = HttpRouter.serve(Layer.mergeAll(liveLayer(group, handlers, {}, null), desktopReportRoute(channel)), {
        disableListenLog: true,
        disableLogger: true,
      }).pipe(
        Layer.provideMerge(BunHttpServer.layer({ hostname: '127.0.0.1', port, gracefulShutdownTimeout: '20 millis' })),
        Layer.provide(admitted),
      );
      const built = yield* Effect.orDie(Layer.build(served));
      const url = new URL(HttpServer.formatAddress(Context.get(built, HttpServer.HttpServer).address));
      return Context.make(ServedChannel, ServedChannel.of({ url })).pipe(Context.merge(made));
    }),
  );

export const servedChannel = servedChannelOn(0);
