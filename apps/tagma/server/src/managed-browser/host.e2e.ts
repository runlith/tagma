import { afterAll, expect } from 'bun:test';
import { it, layer } from '@runlith/effect-test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { headed, notRun } from '@runlith/testbed/fixture';
import { kind, own } from '@runlith/testbed/worlds';
import { Context, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { Pages } from '../browser/contract/service/pages.js';
import { type PageId } from '../browser/contract/wire/ids.js';
import { agentIn, browserWorld, calling, OPERATOR, PAGE, refIn, refusalOf, Seeded, type Served } from '../browser/testing/world.js';
import { MANAGED_AGENT } from './adapter.js';
import { chromeInstalled, INSTALLED, managedFixture, managedTestHost, SHOWN, testAdapter as adapter } from './testing/host.js';

const heard: { readonly path: string; readonly agent: string | null; readonly hints: string | null }[] = [];

const html = (body: string) => new Response(`<!doctype html>${body}`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

const server: Bun.Server<undefined> = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: (request): Response => {
    const path = new URL(request.url).pathname;
    heard.push({ path, agent: request.headers.get('user-agent'), hints: request.headers.get('sec-ch-ua') });
    if (path === '/who')
      return html(`<title>Who</title><button onclick="document.getElementById('list').append(document.createElement('li'))">Add</button><ul id="list"></ul><script>
        const worker = new Worker('/worker.js');
        const shared = new SharedWorker('/shared.js');
        window.told = Promise.all([
          new Promise((done) => { worker.onmessage = (event) => done(event.data); }),
          new Promise((done) => { shared.port.onmessage = (event) => done(event.data); }),
        ]).then(([dedicated, common]) => ({ page: [navigator.userAgent, navigator.userAgentData.brands.map((b) => b.brand)], worker: dedicated, shared: common }));
      </script>`);
    if (path === '/shared.js')
      return new Response(
        `onconnect = (event) => event.ports[0].postMessage([navigator.userAgent, navigator.userAgentData.brands.map((b) => b.brand)]);`,
        {
          headers: { 'content-type': 'text/javascript' },
        },
      );
    if (path === '/worker.js')
      return new Response(
        `fetch('/from-worker').then(() => postMessage([navigator.userAgent, navigator.userAgentData.brands.map((b) => b.brand)]));`,
        { headers: { 'content-type': 'text/javascript' } },
      );
    if (path === '/alert')
      return html('<title>Alert</title><script>addEventListener("load", () => alert("from a page nobody drives"))</script>');
    if (path === '/download')
      return html(`<title>Download</title><iframe src="http://localhost:${new URL(request.url).port}/download-frame"></iframe>`);
    if (path === '/download-frame') return html('<a href="/report.txt">Report</a>');
    if (path === '/report.txt')
      return new Response('twelve bytes', {
        headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="report.txt"' },
      });
    if (path === '/labels')
      return html(`<title>Subscription</title><style>
        body { margin: 0; padding-top: 1400px; }
        button { position: relative; width: 400px; height: 60px; }
        button::after { content: '+'; position: absolute; inset: 0; display: grid; place-items: center; }
        #cover { position: fixed; inset: 0; background: white; display: none; }
        #cover::after { content: 'Cover'; position: absolute; inset: 0; }
      </style><button id="subscription" aria-expanded="false" onclick="this.setAttribute('aria-expanded', 'true')">How do I pause or cancel my Premium subscription?</button><div id="cover"></div>`);
    if (path === '/second') return html('<title>Second</title><h1>Second page</h1>');
    return new Response('ok');
  },
});

afterAll(() => server.stop(true));
const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;

const agent = agentIn(dirname(import.meta.path));

const settled = Effect.fnUntraced(function* <A, E>(page: PageId, probe: Effect.Effect<A | undefined, E, Served>) {
  const changes = yield* (yield* Pages).changes((yield* Seeded).id);
  const pull = yield* Stream.toPull(
    Stream.filter(changes, (event) => event.type === 'list' || (event.type === 'put' && event.page.id === page)),
  );
  for (;;) {
    const found = yield* probe;
    if (found !== undefined) return found;
    yield* pull;
  }
});

const evaluate = (page: PageId, expression: string) =>
  calling(PAGE.evaluate_in_page.body.execute({ page, expression }, undefined, agent)).pipe(
    Effect.map((answer) => ('value' in answer ? (JSON.parse(answer.value) as unknown) : undefined)),
  );

const IDENTITY = 'build %s keeps its identity in workers and requests, drives DOM actions and returns committed navigation';
if (chromeInstalled && !headed()) notRun(IDENTITY.replace('%s', SHOWN), 'headed');
const PROFILES = chromeInstalled ? [MANAGED_AGENT, INSTALLED, ...(headed() ? [SHOWN] : [])] : [MANAGED_AGENT];
const fixture = managedFixture();

layer(fixture, { excludeTestServices: true })('the managed host', (it) => {
  it.effect.each(PROFILES)(IDENTITY, (profile) =>
    Effect.gen(function* () {
      heard.length = 0;
      const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/who'), profile }, undefined, agent));
      const told = (yield* evaluate(opened.page.id, 'window.told')) as {
        readonly page: readonly [string, readonly string[]];
        readonly worker: readonly [string, readonly string[]];
        readonly shared: readonly [string, readonly string[]];
      };
      const seen = [
        ...[told.page, told.worker, told.shared].flatMap(([agent, brands]) => [agent, ...brands]),
        ...heard.flatMap((one) => [one.agent ?? '', one.hints ?? '']),
      ];
      expect(heard.map((one) => one.path)).toContain('/from-worker');
      expect(seen.filter((said) => said.includes('HeadlessChrome'))).toEqual([]);
      expect(told.page[0]).toContain('Chrome/');
      expect([told.worker[0], told.shared[0]]).toEqual([told.page[0], told.page[0]]);
      expect(yield* evaluate(opened.page.id, 'navigator.webdriver')).toBe(false);
      if (profile !== MANAGED_AGENT) expect(told.page[1]).toContain('Google Chrome');
      const shot = yield* calling(PAGE.snapshot_page.body.execute({ page: opened.page.id }, undefined, agent));
      yield* calling(
        PAGE.act_on_page.body.execute(
          { page: opened.page.id, steps: [{ action: 'click', ref: refIn(shot.text, /button "Add"/) }] },
          undefined,
          agent,
        ),
      );
      expect(yield* evaluate(opened.page.id, 'document.querySelectorAll("li").length')).toBe(1);
      const navigated = yield* calling(PAGE.navigate_page.body.execute({ page: opened.page.id, url: at('/second') }, undefined, agent));
      expect(navigated.page.url).toBe(at('/second'));
      expect(yield* evaluate(opened.page.id, 'document.title')).toBe('Second');
    }),
  );

  it.effect('a ref click through a generated button label expands its answer but a covering element still refuses', () =>
    Effect.gen(function* () {
      const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/labels'), profile: INSTALLED }, undefined, agent));
      const page = opened.page.id;
      const pages = yield* Pages;
      yield* Effect.addFinalizer(() => pages.close(page).pipe(Effect.orDie));
      const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
      const ref = refIn(shot.text, /button "How do I pause or cancel/);
      yield* calling(
        PAGE.act_on_page.body.execute(
          {
            page,
            steps: [
              { action: 'scroll', ref },
              { action: 'click', ref },
            ],
          },
          undefined,
          agent,
        ),
      );
      expect(yield* evaluate(page, 'document.getElementById("subscription").getAttribute("aria-expanded")')).toBe('true');
      yield* evaluate(page, 'document.getElementById("cover").style.display = "block"');
      const refused = yield* refusalOf(
        calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref }] }, undefined, agent)),
      );
      expect(refused.code).toBe('element-obscured');
      expect(refused.reason).toContain('#cover');
    }),
  );

  it.effect('an alert on a page nobody drives becomes the dialog in its state', () =>
    Effect.gen(function* () {
      const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/alert'), profile: MANAGED_AGENT }, undefined, OPERATOR));
      const pages = yield* Pages;
      const moves = yield* pages.moves(opened.page.id);
      const opening =
        pages.live(opened.page.id)?.dialog ??
        (yield* Stream.runHead(Stream.filter(moves, (move) => move.live.dialog !== null)).pipe(
          Effect.map((move) => (move._tag === 'Some' ? move.value.live.dialog : null)),
        ));
      expect(opening).toEqual({
        kind: 'alert',
        message: 'from a page nobody drives',
        prompt: null,
        url: at('/alert'),
      });
    }),
  );

  it.effect('a download from a frame of a page without a window lands in the record of that page', () =>
    Effect.gen(function* () {
      const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/download'), profile: MANAGED_AGENT }, undefined, agent));
      const page = opened.page.id;
      yield* settled(
        page,
        Effect.map(Pages, (pages) => (pages.live(page)?.loading === false ? true : undefined)),
      );
      const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
      yield* calling(
        PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', ref: refIn(shot.text, /link "Report"/) }] }, undefined, agent),
      );
      const done = yield* settled(
        page,
        calling(PAGE.read_page_downloads.body.execute({ page }, undefined, agent)).pipe(
          Effect.map((read) => read.downloads.find((download) => download.state === 'done')),
        ),
      );
      expect([done.name, done.bytes]).toEqual(['report.txt', 12]);
      expect(yield* Effect.promise(() => Bun.file(done.path ?? '').text())).toBe('twelve bytes');
      const listed = yield* calling(PAGE.list_pages.body.execute({}, undefined, agent));
      expect(listed.pages.find((held) => held.id === page)?.downloads).toBe(1);
    }),
  );
});

layer(managedFixture({ missing: true }), {
  excludeTestServices: true,
})('the managed host without its build', (it) => {
  it.effect('a page in a profile whose build is missing refuses host-refused naming the build', () =>
    Effect.gen(function* () {
      const refused = yield* refusalOf(
        calling(PAGE.open_page.body.execute({ url: at('/second'), profile: MANAGED_AGENT }, undefined, agent)),
      );
      expect(refused.code).toBe('host-refused');
      expect(refused.reason).toContain('Chrome for Testing');
    }),
  );
});

class ManagedRestart extends Context.Service<ManagedRestart, Context.Context<Served>>()('testing/ManagedRestart') {}
const restartWorld = kind(ManagedRestart, ({ home }: { readonly home: string }) =>
  Layer.build(browserWorld({ host: managedTestHost(home), adapters: [adapter], home, store: join(home, 'tagma.sqlite') })).pipe(
    Effect.orDie,
  ),
);

it.live('after the server restarts, a page of the managed host stands dormant at its address and comes back there', () =>
  Effect.gen(function* () {
    const kept = mkdtempSync(join(tmpdir(), 'managed-restart-'));
    const world = own(restartWorld, { home: kept }, 'закрытие и повторное открытие сервера — предмет теста');
    const run = Effect.fnUntraced(function* <A, E>(work: Effect.Effect<A, E, Served>) {
      const life = yield* Scope.make();
      const built = yield* Scope.provide(world, life);
      return yield* work.pipe(Effect.provide(built), Effect.ensuring(Scope.close(life, Exit.void)));
    });
    const page = yield* run(
      Effect.gen(function* () {
        const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/second'), profile: MANAGED_AGENT }, undefined, agent));
        return opened.page.id;
      }),
    );
    const after = yield* run(
      Effect.gen(function* () {
        const listed = yield* calling(PAGE.list_pages.body.execute({}, undefined, agent));
        const standing = listed.pages.find((held) => held.id === page);
        const shot = yield* calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent));
        return { state: standing?.state, url: standing?.url, text: shot.text };
      }),
    );
    expect([after.state, after.url]).toEqual(['dormant', at('/second')]);
    expect(after.text).toContain('Second page');
  }),
);
