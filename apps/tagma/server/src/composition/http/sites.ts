import { Cause, Effect, Exit, Layer, PubSub, Stream } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { requestLine } from '../../http/door.js';
import { proxyPage } from '../../mcp/sandbox.js';
import type { Access } from '../../remote/contract/service/access.js';
import type { PlacedSites } from '../../remote/contract/service/sites.js';
import type { AccessState } from '../../remote/contract/wire/access.js';
import { TAGMA_APP_ID_PATTERN } from '../../tagma-apps/contract/wire/manifest.js';
import type { TagmaAppViews, ViewSites } from '../../views/contract/service/views.js';
import type { ViewSite } from '../../views/contract/wire/sets.js';
import { siteFile } from '../../views/files.js';

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'] as const;

const LOCAL_DOORS = LOOPBACK.map((name) => `http://${name}:*`).join(' ');

const LOCAL_SUFFIX = '.localhost';

export const framedBy = (parent: string | null): string => (parent === null ? LOCAL_DOORS : `${LOCAL_DOORS} ${parent}`);

export const localSiteOf = (host: string | undefined): string | null => {
  const name = host?.toLowerCase().replace(/:\d+$/u, '') ?? '';
  const label = name.endsWith(LOCAL_SUFFIX) ? name.slice(0, -LOCAL_SUFFIX.length) : '';
  return TAGMA_APP_ID_PATTERN.test(label) ? label : null;
};

export type LocalSites = ViewSites['Service'] & { refuse(reason: string): void };

export const makeLocalSites = Effect.fnUntraced(function* (port: number) {
  const moves = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  let refusal: string | null = null;
  yield* PubSub.publish(moves, undefined);
  return {
    site: (app): ViewSite =>
      refusal === null ? { _tag: 'served', origin: `http://${app}${LOCAL_SUFFIX}:${port}` } : { _tag: 'unserved', reason: refusal },
    moved: Stream.fromPubSub(moves),
    refuse: (reason) => {
      refusal = reason;
      moves.pubsub.slide();
      PubSub.publishUnsafe(moves, undefined);
    },
  } satisfies LocalSites;
});

const unservedBecause = (state: AccessState): string => {
  switch (state._tag) {
    case 'off':
      return 'access from another network is off on this server';
    case 'blocked':
      return state.detail;
    default:
      return 'the server is giving this app an address of its own on Tailscale Serve';
  }
};

export const remoteSites = (placed: PlacedSites['Service']): ViewSites['Service'] => ({
  site: (app) => {
    const state = placed.site(app);
    return state._tag === 'ready' ? { _tag: 'served', origin: state.origin } : { _tag: 'unserved', reason: unservedBecause(state) };
  },
  moved: placed.moved,
});

const unknown = () => HttpServerResponse.text('Nothing is served here.', { status: 404 });

const proxyHost = (host: string | undefined, access: Access['Service']): boolean => {
  const name = host?.toLowerCase().replace(/:\d+$/u, '');
  if (LOOPBACK.some((loopback) => loopback === name)) return true;
  const remote = access.sandboxOrigin;
  return remote !== null && host?.toLowerCase() === new URL(remote).host;
};

export const sandboxRoutes = (views: TagmaAppViews['Service'], access: Access['Service'], placed: PlacedSites['Service']) => {
  const file = siteFile(views);
  return HttpRouter.add('GET', '*', (request) => {
    const framers = framedBy(access.parentOrigin);
    const { pathname, searchParams } = new URL(request.url, 'http://sandbox');
    const host = request.headers.host;
    const app = localSiteOf(host) ?? placed.at(host);
    if (app !== null) return file(app, pathname, framers);
    return Effect.succeed(pathname === '/' && proxyHost(host, access) ? proxyPage(searchParams, framers) : unknown());
  });
};

export const sandboxServing = (views: TagmaAppViews['Service'], access: Access['Service'], placed: PlacedSites['Service']) =>
  HttpRouter.serve(sandboxRoutes(views, access, placed), { disableLogger: true, middleware: requestLine });

const ABSENT = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

const codeOf = (failure: unknown): string | undefined => {
  const found = failure as { readonly code?: unknown; readonly cause?: { readonly code?: unknown } } | null;
  const code = found?.code ?? found?.cause?.code;
  return typeof code === 'string' ? code : undefined;
};

export const loopbackSix = <E, R>(listener: Layer.Layer<never, E, R>, sites: LocalSites, at: string) =>
  Layer.effectDiscard(
    Effect.flatMap(Effect.exit(Layer.build(listener)), (built) => {
      if (Exit.isSuccess(built)) return Effect.void;
      const failure = Cause.squash(built.cause);
      if (ABSENT.has(codeOf(failure) ?? '')) return Effect.void;
      const reason = `this server could not hold ${at}, where browsers look for app views first, so another program there could answer as every app's view (${failure instanceof Error ? failure.message : String(failure)})`;
      return Effect.andThen(
        Effect.sync(() => sites.refuse(reason)),
        Effect.logError('app views are refused on this machine', reason),
      );
    }),
  );
