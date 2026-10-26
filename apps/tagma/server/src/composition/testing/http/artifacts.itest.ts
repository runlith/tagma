import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { versionedShelf } from '../../../artifacts/testing/doubles.js';
import { artifactRoutes } from '../../http/artifacts.js';

const served = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'artifact-port-' });
  const store = yield* versionedShelf(join(root, 'artifacts'), 'http://localhost:5634');
  const { handler, dispose } = HttpRouter.toWebHandler(artifactRoutes(store, { index: '/', sandboxed: false }));
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const publish = Effect.fnUntraced(function* (name: string, html: string) {
    const path = join(root, name);
    yield* fs.writeFileString(path, html);
    return (yield* store.publish({ path, thread: 'thread' })).record;
  });
  return {
    handler: (path: string, headers?: Record<string, string>) =>
      Effect.promise(() => handler(new Request(`http://localhost:5634${path}`, { headers }))),
    publish,
    root,
  };
});
class Pages extends Context.Service<Pages, Effect.Success<typeof served>>()('testing/Pages') {}

layer(Layer.effect(Pages, served).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('artifact routes', (it) => {
  it.effect('a published page answers on its own path, unaltered', () =>
    Effect.gen(function* () {
      const { handler, publish } = yield* Pages;
      const record = yield* publish('page.html', '<!doctype html><title>Burn rate</title><body>the whole page');
      const response = yield* handler(`/a/${record.id}`);

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.text())).toBe('<!doctype html><title>Burn rate</title><body>the whole page');
      expect(response.headers.get('content-type')).toContain('text/html');
    }),
  );

  it.effect('the served page may talk to nobody and load scripts from the named hosts alone', () =>
    Effect.gen(function* () {
      const { handler, publish } = yield* Pages;
      const record = yield* publish('policy.html', '<!doctype html><title>A</title>');
      const policy = (yield* handler(`/a/${record.id}`)).headers.get('content-security-policy');

      expect(policy).toContain("connect-src 'none'");
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain('https://cdnjs.cloudflare.com');
      expect(policy).toContain('https://fonts.gstatic.com');
    }),
  );

  it.effect('the shelf index links to the next bounded page and refuses an invalid cursor', () =>
    Effect.gen(function* () {
      const { handler, publish } = yield* Pages;
      for (let page = 0; page < 51; page += 1) yield* publish(`index-${page}.html`, `<title>Index ${page}</title>`);
      const first = yield* handler('/');
      const html = yield* Effect.promise(() => first.text());
      expect(first.status).toBe(200);
      expect([...html.matchAll(/<li>/g)]).toHaveLength(50);
      const next = /href="(\?cursor=[^"]+)"/.exec(html)?.[1];
      expect(next).toBeDefined();
      const second = yield* handler(`/${next}`);
      const rest = yield* Effect.promise(() => second.text());
      expect(second.status).toBe(200);
      expect([...rest.matchAll(/<li>/g)].length).toBeGreaterThan(0);
      expect([...rest.matchAll(/<li>/g)].length).toBeLessThan(50);
      expect((yield* handler('/?cursor=bad')).status).toBe(400);
    }),
  );

  it.effect('a video kept with a version downloads whole or by the byte range asked, and a name outside the shelf does not answer', () =>
    Effect.gen(function* () {
      const { handler, publish, root } = yield* Pages;
      const fs = yield* FileSystem.FileSystem;
      const record = yield* publish('motion.html', '<!doctype html><title>Motion</title>');
      yield* fs.writeFile(join(root, 'artifacts', record.id, record.version, 'video-30-1x.mp4'), new TextEncoder().encode('0123456789'));
      const address = `/a/${record.id}/v/${record.version}/video-30-1x.mp4`;

      const whole = yield* handler(address);
      expect(whole.status).toBe(200);
      expect(whole.headers.get('content-type')).toBe('video/mp4');
      expect(whole.headers.get('content-disposition')).toContain('attachment');
      expect(yield* Effect.promise(() => whole.text())).toBe('0123456789');
      const part = yield* handler(address, { range: 'bytes=2-5' });
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
      expect(yield* Effect.promise(() => part.text())).toBe('2345');
      expect((yield* handler(address, { range: 'bytes=-3' })).headers.get('content-range')).toBe('bytes 7-9/10');
      expect((yield* handler(address, { range: 'bytes=20-' })).status).toBe(416);
      expect((yield* handler(`/a/${record.id}/v/${record.version}/page.html`)).status).toBe(404);
      expect((yield* handler(`/a/${record.id}/v/${record.version}/video-30-2x.mp4`)).status).toBe(404);
    }),
  );

  it.effect(
    'an older version answers by name and caches for good, the current address never, and an id nobody published does not answer',
    () =>
      Effect.gen(function* () {
        const { handler, publish } = yield* Pages;
        const first = yield* publish('history.html', '<!doctype html><title>A</title><body>first');
        const second = yield* publish('history.html', '<!doctype html><title>A</title><body>second');
        const standing = yield* handler(`/a/${second.id}`);
        const older = yield* handler(`/a/${first.id}/v/${first.version}`);
        const nothing = yield* handler('/a/deadbeef1234');

        expect(yield* Effect.promise(() => standing.text())).toContain('second');
        expect(standing.headers.get('cache-control')).toBe('no-store');
        expect(yield* Effect.promise(() => older.text())).toContain('first');
        expect(older.headers.get('cache-control')).toContain('immutable');
        expect(nothing.status).toBe(404);
        expect(nothing.headers.get('cache-control')).toBe('no-store');
      }),
  );
});
