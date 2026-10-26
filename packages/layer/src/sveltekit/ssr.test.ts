import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('esm-env', () => ({ BROWSER: false, DEV: true, NODE: true }));
vi.mock('$app/navigation', () => ({ goto: () => Promise.resolve(), invalidate: () => Promise.resolve() }));
vi.mock('$app/state', () => ({ page: {} }));

const url = new URL('http://tagma.test/threads');

const requestEvent = {
  request: new Request(url, { headers: { 'accept-language': 'nl;q=0.5, en' } }),
  url,
  cookies: { get: () => undefined, getAll: () => [], set: () => undefined, delete: () => undefined },
  fetch: () => Promise.resolve(new Response()),
  params: {},
  route: { id: '/threads' },
} as unknown as RequestEvent;

afterEach(() => {
  vi.unstubAllGlobals();
});

const BROWSER_GLOBALS = ['window', 'self', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage'];

it.each([
  [{ 'x-forwarded-proto': 'https' }, true],
  [{ 'cf-visitor': '{"scheme":"https"}', 'x-forwarded-proto': 'http' }, true],
  [{ 'x-forwarded-proto': 'http' }, false],
] as const)('cookies follow the public request protocol with headers %j', async (headers, secure) => {
  const { Platform } = await import('../Platform.js');
  const { Router } = await import('../Router.js');
  const { App } = await import('./server.js');
  const { Layer } = await import('../Layer.js');
  const written: boolean[] = [];
  const removed: boolean[] = [];
  const event = {
    ...requestEvent,
    request: new Request(url, { headers }),
    cookies: {
      ...requestEvent.cookies,
      set: (_name: string, _value: string, options: { secure?: boolean }) => written.push(options.secure!),
      delete: (_name: string, options: { secure?: boolean }) => removed.push(options.secure!),
    },
  } as unknown as RequestEvent;
  const handle = App.handle(App.define(Layer.mergeAll()), ({ app }) => {
    const cookies = app.resolve(Platform).cookies;
    cookies.set('session', 'token');
    cookies.delete('session');
    cookies.set('explicit', 'token', { secure: !secure });
    cookies.delete('explicit', { secure: !secure });
    return new Response(app.resolve(Router).url.protocol);
  });
  const response = await handle({ event, resolve: () => new Response() });
  expect(await response.text()).toBe(secure ? 'https:' : 'http:');
  expect(written).toEqual([secure, !secure]);
  expect(removed).toEqual([secure, !secure]);
});

describe('the SvelteKit doors with the browser globals removed', () => {
  it('load with no window, document, navigator, location or storage, and a server load answers inside the request', async () => {
    for (const name of BROWSER_GLOBALS) vi.stubGlobal(name, undefined);

    const { Platform } = await import('../Platform.js');
    const { Service } = await import('../key.js');
    const { App } = await import('./index.js');
    const server = await import('./server.js');

    class Seen extends Service<Seen>()('Seen', { tier: 'app' }) {
      static *make() {
        const platform = yield* Platform;
        return new Seen(platform.kind, platform.languages, platform.storage.local.getItem('anything'));
      }
      constructor(
        readonly kind: string,
        readonly languages: readonly string[],
        readonly stored: string | null,
      ) {
        super();
      }
    }

    const definition = App.define(Seen);
    const load = App.load(definition, function* () {
      const seen = yield* Seen;
      return { kind: seen.kind, languages: [...seen.languages], stored: seen.stored };
    });
    const handle = server.App.handle(definition, async ({ event }) => {
      const answer = await load({
        url: event.url,
        route: event.route,
        parent: () => Promise.resolve({}),
        depends: () => undefined,
        untrack: <T>(fn: () => T): T => fn(),
        data: undefined,
      });
      return Response.json(answer);
    });

    const response = await handle({ event: requestEvent, resolve: (_event: RequestEvent, _options?: ResolveOptions) => new Response() });

    expect(await response.json()).toMatchObject({ kind: 'server', languages: ['en', 'nl'], stored: null });
  });
});
