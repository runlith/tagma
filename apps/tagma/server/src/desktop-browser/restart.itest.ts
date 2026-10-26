import { expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { kind, own } from '@runlith/testbed/worlds';
import { Context, Deferred, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { Automation } from '../browser/contract/service/automation.js';
import { Hosts } from '../browser/contract/service/hosts.js';
import { Pages } from '../browser/contract/service/pages.js';
import type { PageId } from '../browser/contract/wire/ids.js';
import { browserWorld, refIn, Seeded, type Served } from '../browser/testing/world.js';
import { desktopAdapter } from './adapter.js';
import { DESKTOP } from './contract/wire/channel.js';
import { launchElectron } from './testing/electron.js';
import { servedChannelOn } from './testing/served.js';

const SITE = `<!doctype html><title>Form</title><button id="add" onclick="const li = document.createElement('li'); li.textContent = 'Item'; document.getElementById('list').append(li)">Add</button><ul id="list"></ul>`;

const THREAD = 'agent';

class Restart extends Context.Service<Restart, Context.Context<Served | Hosts>>()('testing/DesktopRestart') {}
const restartWorld = kind(Restart, ({ home, port }: { readonly home: string; readonly port: number }) =>
  Layer.build(
    browserWorld({
      host: Layer.effectDiscard(Effect.asVoid(Layer.build(servedChannelOn(port)))),
      adapters: [desktopAdapter],
      home,
      store: join(home, 'tagma.sqlite'),
    }),
  ).pipe(Effect.orDie),
);

const freePort = Effect.promise(async () => {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const free = probe.port as number;
  await probe.stop(true);
  return free;
});

it.live(
  'a page survives a surface reload and a restart of its server, keeps its address and history, and the agent goes on driving the same document',
  () =>
    Effect.gen(function* () {
      const site = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(SITE, { headers: { 'content-type': 'text/html' } }) }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      );
      const address = `http://127.0.0.1:${site.port}/form`;
      const home = mkdtempSync(join(tmpdir(), 'desktop-restart-'));
      const port = yield* freePort;
      const world = own(restartWorld, { home, port }, 'закрытие и повторное открытие сервера — предмет теста');
      const live = Effect.gen(function* () {
        const hosts = yield* Hosts;
        const attached = yield* Deferred.make<void>();
        yield* hosts.watch({
          attached: (host) => (host.adapter === DESKTOP ? Effect.asVoid(Deferred.succeed(attached, undefined)) : Effect.void),
          detached: () => Effect.void,
        });
        if (hosts.connected(DESKTOP) === undefined) yield* Deferred.await(attached);
      });
      const items = (page: PageId) =>
        Effect.flatMap(Automation, (automation) => automation.evaluate(page, 'document.querySelectorAll("li").length', THREAD)).pipe(
          Effect.map((answer) => ('value' in answer ? Number(answer.value) : answer.exception)),
        );
      const click = Effect.fnUntraced(function* (page: PageId) {
        const automation = yield* Automation;
        const shot = yield* automation.snapshot(page, { within: undefined, limit: 200 }, THREAD);
        yield* automation.act(page, { kind: 'click', aim: { ref: refIn(shot.text, /button "Add"/) } }, THREAD);
      });

      const first = yield* Scope.fork(yield* Effect.scope);
      const before = yield* Scope.provide(world, first);
      const electron = yield* launchElectron(home, new URL(`http://127.0.0.1:${port}`));
      yield* live.pipe(Effect.provide(before));
      const page = yield* Effect.gen(function* () {
        const pages = yield* Pages;
        const seeded = yield* Seeded;
        return (yield* pages.open({ projectId: seeded.id, thread: THREAD, human: false }, { url: address, profile: undefined })).id;
      }).pipe(Effect.provide(before));
      const next = `${address}?next`;
      const navigated = yield* Effect.flatMap(Automation, (automation) =>
        automation.navigate(page, { kind: 'url', url: next }, THREAD),
      ).pipe(Effect.provide(before));
      expect(navigated.url).toBe(next);
      yield* click(page).pipe(Effect.provide(before));
      yield* electron.control({ show: page });
      yield* electron.control({ reload: true });
      yield* click(page).pipe(Effect.provide(before));
      expect(yield* items(page).pipe(Effect.provide(before))).toBe(2);
      yield* Scope.close(first, Exit.void);

      const after = yield* world;
      yield* live.pipe(Effect.provide(after));
      const pages = Context.get(after, Pages);
      const seeded = Context.get(after, Seeded);
      const changes = yield* pages.changes(seeded.id);
      const recovered = yield* Stream.runHead(
        Stream.filter(
          Stream.flatMap(changes, (event) =>
            Stream.fromIterable(event.type === 'list' ? event.pages : event.type === 'put' ? [event.page] : []),
          ),
          (standing) => standing.id === page && standing.state === 'live' && standing.live.back,
        ),
      );
      expect(recovered._tag === 'Some' ? recovered.value.url : null).toBe(next);
      yield* click(page).pipe(Effect.provide(after));
      expect(yield* items(page).pipe(Effect.provide(after))).toBe(3);
    }),
);
