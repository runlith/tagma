import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Pages } from '../contract/service/pages.js';
import { Automation } from '../contract/service/automation.js';
import { type HostAdapter, Hosts } from '../contract/service/hosts.js';
import { Profiles } from '../contract/service/profiles.js';
import { AGENT_PROFILE, type PageId, ProfileId } from '../contract/wire/ids.js';
import { PAGE_PAIRS as PAGE, PROFILE_PAIRS as PROFILE } from '../operations.js';
import { agentIn, calling, OPERATOR, refIn, refusalOf, type Served } from './world.js';

const PAGES: Readonly<Record<string, string>> = {
  '/form': `<!doctype html><title>Form</title>
    <label>Name <input id="name"></label>
    <label>Notes <textarea id="notes"></textarea></label>
    <button id="add" onclick="const li = document.createElement('li'); li.textContent = 'Item ' + (document.querySelectorAll('li').length + 1); document.getElementById('list').append(li)">Add</button>
    <ul id="list"></ul><a href="/second">Second</a>`,
  '/second': '<!doctype html><title>Second</title><h1>Second page</h1>',
  '/covered': `<!doctype html><title>Covered</title>
    <button id="under" style="position:absolute;left:20px;top:20px;width:120px;height:40px">Under</button>
    <div id="cover" style="position:absolute;left:0;top:0;width:400px;height:200px;background:rgba(0,0,0,.5)">Cookie banner</div>`,
  '/scrolled': `<!doctype html><title>Scrolled</title><body style="margin:0;height:2800px">
    <div style="height:1400px"></div><button id="flow" onclick="this.dataset.clicked = 'yes'">Below the fold</button>
    <div style="position:fixed;left:30px;top:17px">
      <button id="fixed" aria-label="Close banner" onclick="this.dataset.clicked = 'yes'"><svg width="32" height="25"><path d="M0 0H32V25H0Z"/></svg></button>
      <input id="field" aria-label="Scrolled field" style="display:block;width:120px;height:24px;margin-top:20px">
    </div>
    <button id="under" style="position:fixed;left:30px;top:140px;width:120px;height:40px">Scrolled under</button>
    <div id="scroll-cover" style="position:fixed;left:20px;top:130px;width:160px;height:60px;background:#333;color:#fff">Scroll cover</div>`,
  '/scrolled-inner': `<!doctype html><title>Scrolled inner</title><body style="margin:0;height:2000px">
    <div style="position:fixed;inset:0">
      <button style="position:absolute;left:10px;top:10px;width:120px;height:30px">Frame hidden</button>
      <button style="position:absolute;left:10px;top:70px;width:120px;height:30px">Child under</button>
      <div id="child-cover" style="position:absolute;left:0;top:60px;width:140px;height:50px;background:#aaa">Child cover</div>
      <button id="open" style="position:absolute;left:10px;top:120px;width:120px;height:30px" onclick="this.textContent = 'Frame pressed'">Frame open</button>
      <input aria-label="Scrolled frame field" style="position:absolute;left:200px;top:110px;width:150px;height:24px">
    </div><script>addEventListener('load', () => { scrollTo(0, 600); parent.postMessage('Child scroll ' + scrollY, '*'); });</script>`,
  '/console': `<!doctype html><title>Console</title><p id="state">loading</p>
    <script>console.error('boom from the page'); fetch('/data').then((r) => r.text()).then(() => { document.getElementById('state').textContent = 'loaded'; });</script>`,
  '/console-shapes': `<!doctype html><title>Console shapes</title><button id="report" onclick="report()">Report</button><p id="state">waiting</p>
    <script>function report() {
      console.log('tagma: hello from the agent', { links: 382, nested: { deep: true } }, [1, 'two', null]);
      console.log('%s has %d items at %f %cstyled %o', 'cart', 3.7, 1.5, 'color: red', { id: 7 });
      console.log(new Map([['k', 1]]), new Set([2]), document.getElementById('report'), function shout(word) { return word; });
      console.table([{ a: 1, b: 'x' }]);
      console.trace('traced here');
      console.error(new TypeError('bad input'));
      console.log('%s!', '%s %s', 'Hello', 'World');
      console.log('%f|%f', Infinity, -Infinity, function pick({ x }) { return x; }, { '[[PromiseState]]': 'pending', tab: 'a\\tb' });
      setTimeout(() => { document.getElementById('state').textContent = 'reported'; throw new RangeError('thrown later'); });
    }</script>`,
  '/confirm': `<!doctype html><title>Confirm</title>
    <button id="ask" onclick="document.getElementById('said').textContent = confirm('Proceed?') ? 'yes' : 'no'">Ask</button><p id="said">none</p>`,
  '/inner': `<!doctype html><title>Inner</title>
    <button id="hidden" style="position:absolute;left:10px;top:10px;width:120px;height:30px">Hidden</button>
    <button id="open" style="position:absolute;left:10px;top:120px;width:120px;height:30px" onclick="this.textContent = 'Pressed'">Open</button>
    <input id="field" aria-label="Field" style="position:absolute;left:200px;top:110px;width:150px;height:24px">
    <input id="agree" type="checkbox" aria-label="Agree" style="position:absolute;left:200px;top:150px;width:20px;height:20px;margin:0">
    <iframe src="/nested" style="position:absolute;left:180px;top:70px;width:200px;height:30px;border:0"></iframe>
    <button style="position:absolute;left:10px;top:165px" onclick="fetch('/frame-data').then(r => r.text()).then(() => parent.postMessage('Frame data loaded', '*'))">Load data</button>`,
  '/nested': `<!doctype html><title>Nested</title><button style="margin:0" onclick="this.textContent = 'Nested pressed'">Nested</button>`,
  '/leave': `<!doctype html><title>Leave</title><input id="draft" aria-label="Draft">
    <script>addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = ''; });</script>`,
  '/pick': `<!doctype html><title>Pick</title>
    <button id="target" data-testid="pick-me" style="margin:40px;width:160px;height:50px" onclick="this.textContent = 'Clicked'">Pick me</button>`,
};

const HEAVY = `<!doctype html><title>Heavy</title><button id="spin" onclick="fetch('/spinning'); for (;;) {}">Spin</button>${Array.from(
  { length: 100 },
  (_, at) =>
    `<section><h3>Section ${at}</h3><p>Paragraph ${at} with some words.</p><a href="#s${at}">Link ${at}</a><button>Do ${at}</button><input aria-label="Field ${at}"></section>`,
).join('')}`;

const ABSENT = ProfileId.make('absent-agent');

class EnginePage extends Context.Service<EnginePage, { current: PageId | undefined }>()('testing/EnginePage') {}

export type EngineHost = {
  readonly name: string;
  readonly adapter: HostAdapter;
  readonly profile: ProfileId;
  readonly fixture: () => Layer.Layer<Served | Hosts>;
};

export const engineScenarios = (input: EngineHost): void => {
  const spinning = Deferred.makeUnsafe<void>();
  const childSpinning = Deferred.makeUnsafe<void>();
  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request): Response => {
      const path = new URL(request.url).pathname;
      if (path === '/data') return Response.json({ ok: true });
      if (path === '/frame-data') return new Response('response from the other-process frame');
      if (path === '/spinning') {
        Deferred.doneUnsafe(spinning, Exit.void);
        return new Response(null, { status: 204 });
      }
      if (path === '/child-spinning') {
        Deferred.doneUnsafe(childSpinning, Exit.void);
        return new Response(null, { status: 204 });
      }
      if (path === '/hung-inner')
        return new Response('<!doctype html><script>fetch("/child-spinning"); for (;;) {}</script>', {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      if (path === '/hung-frame')
        return new Response(`<!doctype html><iframe src="http://hung.localhost:${server.port}/hung-inner"></iframe>`, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      if (path === '/favicon.ico') return new Response(null, { status: 204 });
      if (path === '/heavy') return new Response(HEAVY, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (path === '/scrolled-frame') {
        return new Response(
          `<!doctype html><title>Scrolled frame</title><body style="margin:0;height:2800px">
          <iframe src="http://localhost:${server.port}/scrolled-inner" style="position:fixed;left:80px;top:140px;width:400px;height:200px;border:0"></iframe>
          <div id="frame-banner" style="position:fixed;left:80px;top:140px;width:400px;height:60px;background:#333;color:#fff">Frame banner</div>
          <p id="frame-state"></p>
          <script>addEventListener('message', event => { document.getElementById('frame-state').textContent = event.data; });</script>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      if (path === '/framed') {
        return new Response(
          `<!doctype html><title>Framed</title>
          <iframe src="http://localhost:${server.port}/inner" style="position:absolute;left:0;top:0;width:400px;height:200px;border:0"></iframe>
          <div id="banner" style="position:absolute;left:0;top:0;width:400px;height:60px;background:#333;color:#fff">Consent banner</div>
          <p id="frame-state" style="position:absolute;top:220px"></p>
          <script>addEventListener('message', event => { document.getElementById('frame-state').textContent = event.data; });</script>`,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      const html = PAGES[path];
      return html === undefined
        ? new Response('missing', { status: 404 })
        : new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  afterAll(() => server.stop(true));
  const at = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const home = mkdtempSync(join(tmpdir(), 'browser-engine-'));
  const world = Layer.effect(
    EnginePage,
    Effect.gen(function* () {
      const record = yield* (yield* Profiles).record(input.profile);
      const host = yield* (yield* Hosts).reach(record.adapter);
      yield* host.profiles.prepare(record);
      const pages = yield* Pages;
      const held = EnginePage.of({ current: undefined });
      yield* Effect.addFinalizer(() =>
        held.current === undefined || pages.live(held.current) === undefined ? Effect.void : pages.close(held.current).pipe(Effect.orDie),
      );
      return held;
    }),
  ).pipe(Layer.provideMerge(input.fixture()));
  const agent = agentIn(home);
  const open = Effect.fnUntraced(function* (path: string) {
    const held = yield* EnginePage;
    const pages = yield* Pages;
    if (held.current !== undefined && pages.live(held.current) !== undefined) {
      yield* calling(PAGE.navigate_page.body.execute({ page: held.current, url: at(path) }, undefined, agent));
      return held.current;
    }
    const opened = yield* calling(PAGE.open_page.body.execute({ url: at(path), profile: input.profile }, undefined, agent));
    held.current = opened.page.id;
    return opened.page.id;
  });
  const loaded = Effect.fnUntraced(function* (page: PageId) {
    const pages = yield* Pages;
    const moves = yield* pages.moves(page);
    if (pages.live(page)?.loading === false) return;
    yield* Stream.runHead(Stream.filter(moves, (move) => !move.live.loading));
  });
  const snapshot = (page: PageId) =>
    calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent)).pipe(Effect.map((shot) => shot.text));
  const act = (page: PageId, action: Omit<Parameters<typeof PAGE.act_on_page.body.execute>[0], 'page'>) =>
    calling(PAGE.act_on_page.body.execute({ ...action, page }, undefined, agent));
  const evaluate = (page: PageId, expression: string) =>
    calling(PAGE.evaluate_in_page.body.execute({ page, expression }, undefined, agent)).pipe(
      Effect.map((answer) => ('value' in answer ? (JSON.parse(answer.value) as unknown) : answer.exception)),
    );

  layer(world, { excludeTestServices: true })(`the engine on ${input.name}`, (it) => {
    it.effect('the host carries stable refs, DOM input, viewport capture and navigation through its CDP session', () =>
      Effect.gen(function* () {
        const page = yield* open('/form');
        const shot = yield* snapshot(page);
        const second = yield* snapshot(page);
        const ref = refIn(shot, /button "Add"/);
        expect(refIn(second, /button "Add"/)).toBe(ref);
        expect(refIn(second, /textbox "Name"/)).toBe(refIn(shot, /textbox "Name"/));
        yield* act(page, { action: 'click', ref });
        expect(yield* evaluate(page, 'document.querySelectorAll("li").length')).toBe(1);
        yield* act(page, { action: 'fill', ref: refIn(shot, /textbox "Name"/), text: 'Tom & Jerry — привет' });
        yield* act(page, { action: 'type', ref: refIn(shot, /textbox "Notes"/), text: 'a&b ü 日本' });
        expect(yield* evaluate(page, '[document.getElementById("name").value, document.getElementById("notes").value]')).toEqual([
          'Tom & Jerry — привет',
          'a&b ü 日本',
        ]);
        yield* calling(PAGE.emulate_page.body.execute({ page, viewport: { width: 900, height: 700, scale: 1 } }, undefined, agent));
        const captured = yield* calling(PAGE.capture_page.body.execute({ page }, undefined, agent));
        expect([captured.width, captured.height]).toEqual([900, 700]);
        const navigated = yield* calling(PAGE.navigate_page.body.execute({ page, url: at('/second') }, undefined, OPERATOR));
        expect(navigated.page.url).toBe(at('/second'));
        yield* loaded(page);
        expect(refIn(yield* snapshot(page), /heading "Second page"/)).toMatch(/^e\d+$/);
        expect((yield* refusalOf(act(page, { action: 'click', ref }))).code).toBe('stale-ref');
      }),
    );

    it.effect('a covered element refuses element-obscured and names what covers it', () =>
      Effect.gen(function* () {
        const page = yield* open('/covered');
        const refused = yield* refusalOf(act(page, { action: 'click', ref: refIn(yield* snapshot(page), /button "Under"/) }));
        expect(refused.code).toBe('element-obscured');
        expect(refused.reason).toContain('#cover');
      }),
    );

    it.effect('a scrolled page clicks flow and fixed refs, focuses by viewport point and names a real cover', () =>
      Effect.gen(function* () {
        const page = yield* open('/scrolled');
        const shot = yield* snapshot(page);
        expect(yield* evaluate(page, 'document.getElementById("flow").getBoundingClientRect().top >= innerHeight')).toBe(true);
        const flow = yield* Effect.result(act(page, { action: 'click', ref: refIn(shot, /button "Below the fold"/) }));
        const flowed = yield* evaluate(page, '[document.getElementById("flow").dataset.clicked, scrollY > 0]');
        expect(yield* evaluate(page, '(scrollTo(0, 851), scrollY)')).toBe(851);
        const fixed = yield* Effect.result(act(page, { action: 'click', ref: refIn(shot, /button "Close banner"/) }));
        const focused = yield* Effect.result(act(page, { action: 'focus', x: 90, y: 90 }));
        const standing = yield* evaluate(page, '[document.getElementById("fixed").dataset.clicked, document.activeElement.id, scrollY]');
        const refused = yield* refusalOf(act(page, { action: 'click', ref: refIn(shot, /button "Scrolled under"/) }));
        expect({ flow, fixed, focused }).toMatchObject({
          flow: { _tag: 'Success' },
          fixed: { _tag: 'Success' },
          focused: { _tag: 'Success' },
        });
        expect(flowed).toEqual(['yes', true]);
        expect(standing).toEqual(['yes', 'field', 851]);
        expect(refused.code).toBe('element-obscured');
        expect(refused.reason).toContain('#scroll-cover');
      }),
    );

    it.effect('independently scrolled out-of-process frames keep viewport input and name covers in both sessions', () =>
      Effect.gen(function* () {
        const page = yield* open('/scrolled-frame');
        yield* calling(
          PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Child scroll 600', timeoutMs: 10_000 }, undefined, agent),
        );
        expect(yield* evaluate(page, '(scrollTo(0, 851), scrollY)')).toBe(851);
        const shot = yield* snapshot(page);
        const outer = yield* refusalOf(act(page, { action: 'click', ref: refIn(shot, /button "Frame hidden"/) }));
        const inner = yield* refusalOf(act(page, { action: 'click', ref: refIn(shot, /button "Child under"/) }));
        const clicked = yield* Effect.result(act(page, { action: 'click', ref: refIn(shot, /button "Frame open"/) }));
        const focused = yield* Effect.result(act(page, { action: 'focus', x: 355, y: 262 }));
        yield* act(page, { action: 'type', text: 'scrolled frame' });
        expect({ clicked, focused }).toMatchObject({ clicked: { _tag: 'Success' }, focused: { _tag: 'Success' } });
        expect(outer.code).toBe('element-obscured');
        expect(outer.reason).toContain('#frame-banner');
        expect(inner.code).toBe('element-obscured');
        expect(inner.reason).toContain('#child-cover');
        const after = yield* snapshot(page);
        expect(refIn(after, /button "Frame pressed"/)).toBe(refIn(shot, /button "Frame open"/));
        expect(after).toMatch(/textbox "Scrolled frame field".* value="scrolled frame"/);
      }),
    );

    it.effect('an out-of-process frame supports refs, coordinate input and idempotent check while its banner refuses obscured clicks', () =>
      Effect.gen(function* () {
        const page = yield* open('/framed');
        yield* loaded(page);
        const shot = yield* snapshot(page);
        const refused = yield* refusalOf(act(page, { action: 'click', ref: refIn(shot, /button "Hidden"/) }));
        expect(refused.code).toBe('element-obscured');
        expect(refused.reason).toContain('#banner');
        yield* act(page, { action: 'click', ref: refIn(shot, /button "Open"/) });
        expect(refIn(yield* snapshot(page), /button "Pressed"/)).toMatch(/^e\d+$/);
        yield* act(page, { action: 'click', ref: refIn(shot, /button "Nested"/) });
        expect(refIn(yield* snapshot(page), /button "Nested pressed"/)).toMatch(/^e\d+$/);
        yield* act(page, { action: 'fill', x: 275, y: 122, text: 'по точке' });
        yield* act(page, { action: 'check', x: 210, y: 160 });
        yield* act(page, { action: 'check', x: 210, y: 160 });
        const filled = yield* snapshot(page);
        expect(filled).toMatch(/textbox "Field".* value="по точке"/);
        expect(filled).toMatch(/checkbox "Agree".*\[checked\]/);
      }),
    );

    it.effect('another-process frame response body is read in its session and becomes unavailable after navigation', () =>
      Effect.gen(function* () {
        const page = yield* open('/framed');
        yield* loaded(page);
        yield* act(page, { action: 'click', ref: refIn(yield* snapshot(page), /button "Load data"/) });
        yield* calling(
          PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'Frame data loaded', timeoutMs: 10_000 }, undefined, agent),
        );
        const network = yield* calling(PAGE.read_page_network.body.execute({ page, match: '/frame-data' }, undefined, agent));
        expect(network.status).toBe('read');
        if (network.status !== 'read') return;
        expect(network.total).toBe(1);
        const request = network.requests[0]!.request;
        const body = yield* calling(PAGE.read_page_network.body.execute({ page, body: request }, undefined, agent));
        expect(body).toMatchObject({ status: 'body', body: 'response from the other-process frame', base64: false, cut: false });
        yield* open('/second');
        yield* loaded(page);
        expect((yield* refusalOf(calling(PAGE.read_page_network.body.execute({ page, body: request }, undefined, agent)))).code).toBe(
          'body-unavailable',
        );
      }),
    );

    it.effect('a hung out-of-process frame refuses attachment work and unsafe reload, and closes without holding the queue', () =>
      Effect.gen(function* () {
        const own = yield* open('/second');
        const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/hung-frame'), profile: input.profile }, undefined, OPERATOR));
        const page = opened.page.id;
        const pages = yield* Pages;
        yield* Effect.addFinalizer(() => (pages.live(page) === undefined ? Effect.void : pages.close(page).pipe(Effect.orDie)));
        yield* Deferred.await(childSpinning);
        const refused = yield* refusalOf(calling(PAGE.navigate_page.body.execute({ page, go: 'reload' }, undefined, agent)));
        expect(refused.code).toBe('page-unresponsive');
        expect(refused.reason).toContain(`http://hung.localhost:${server.port}/hung-inner`);
        expect(refused.unblock.join(' ')).toContain(page);
        expect((yield* refusalOf(snapshot(page))).code).toBe('page-unresponsive');
        expect((yield* refusalOf(act(page, { action: 'click', x: 20, y: 20 }))).code).toBe('page-unresponsive');
        expect((yield* refusalOf(calling(PAGE.navigate_page.body.execute({ page, go: 'reload' }, undefined, agent)))).code).toBe(
          'page-unresponsive',
        );
        yield* pages.mark(page, { responsive: true });
        const listed = yield* calling(PAGE.list_pages.body.execute({}, undefined, agent));
        expect(listed.pages.find((held) => held.id === page)?.live.responsive).toBe(false);
        expect(refused.unblock.some((line) => line.includes(own) && line.includes('agent'))).toBe(true);
        yield* calling(PAGE.close_page.body.execute({ page }, undefined, OPERATOR));
        const remaining = yield* calling(PAGE.list_pages.body.execute({}, undefined, agent));
        expect(remaining.pages.some((held) => held.id === page)).toBe(false);
        expect(refIn(yield* snapshot(own), /heading "Second page"/)).toMatch(/^e\d+$/);
      }),
    );

    it.effect('a console error and a request of a loopback page are read with their totals', () =>
      Effect.gen(function* () {
        const page = yield* open('/console');
        yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'loaded', timeoutMs: 10_000 }, undefined, agent));
        const console = yield* calling(PAGE.read_page_console.body.execute({ page, level: 'error' }, undefined, agent));
        expect(console.entries.map((entry) => entry.text)).toContain('boom from the page');
        expect(console.total).toBe(1);
        const network = yield* calling(PAGE.read_page_network.body.execute({ page, match: '/data' }, undefined, agent));
        expect(network.status).toBe('read');
        if (network.status !== 'read') return;
        expect(network.total).toBe(1);
        expect(network.requests[0]?.status).toBe(200);
      }),
    );

    it.effect('console reads render previews, format specifiers, call kinds and stacks as DevTools shows them', () =>
      Effect.gen(function* () {
        const page = yield* open('/console-shapes');
        const read = (input: { readonly after?: number; readonly seq?: number; readonly stack?: boolean }) =>
          calling(PAGE.read_page_console.body.execute({ page, ...input }, undefined, agent));
        const before = (yield* read({})).entries.at(-1)?.seq ?? 0;
        yield* act(page, { action: 'click', ref: refIn(yield* snapshot(page), /button "Report"/) });
        yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'text', value: 'reported', timeoutMs: 10_000 }, undefined, agent));
        const plain = yield* read({ after: before });
        expect(plain.entries.map(({ kind, text }) => [kind, text])).toEqual([
          ['log', "tagma: hello from the agent {links: 382, nested: {…}} (3) [1, 'two', null]"],
          ['log', 'cart has 3 items at 1.5 styled {id: 7}'],
          ['log', "Map(1) {'k' => 1} Set(1) {2} button#report ƒ shout(word)"],
          ['table', "[{a: 1, b: 'x'}]"],
          ['trace', 'traced here'],
          ['error', 'TypeError: bad input'],
          ['log', 'Hello World!'],
          ['log', "Infinity|-Infinity ƒ pick({ x }) {[[PromiseState]]: 'pending', tab: 'a\\tb'}"],
          [null, 'Uncaught RangeError: thrown later'],
        ]);
        expect(plain.entries.every((entry) => entry.stack === undefined)).toBe(true);
        const one = yield* read({ seq: before + 2 });
        expect([one.total, one.entries.map((entry) => entry.text)]).toEqual([1, [plain.entries[1]!.text]]);
        const stacked = yield* read({ after: before + 4, stack: true });
        expect(stacked.entries.map((entry) => entry.stack?.split('\n')[0])).toEqual([
          `at report (${at('/console-shapes')}:7:15)`,
          `at report (${at('/console-shapes')}:8:21)`,
          `at report (${at('/console-shapes')}:9:15)`,
          `at report (${at('/console-shapes')}:10:15)`,
          expect.stringMatching(new RegExp(`^at <anonymous> \\(${at('/console-shapes')}:11:\\d+\\)$`)),
        ]);
      }),
    );

    it.effect('a profile that never captures console refuses console-off', () =>
      Effect.gen(function* () {
        const page = yield* open('/second');
        yield* calling(PROFILE.update_profile.body.execute({ profile: input.profile, console: 'never' }, undefined, agent));
        const refused = yield* refusalOf(calling(PAGE.read_page_console.body.execute({ page }, undefined, agent)));
        yield* calling(PROFILE.update_profile.body.execute({ profile: input.profile, console: 'auto' }, undefined, agent));
        expect(refused.code).toBe('console-off');
      }),
    );

    it.effect('an open confirm refuses other actions until it is answered', () =>
      Effect.gen(function* () {
        const page = yield* open('/confirm');
        const shot = yield* snapshot(page);
        const asked = yield* act(page, { action: 'click', ref: refIn(shot, /button "Ask"/) });
        expect(asked.page.dialog?.kind).toBe('confirm');
        expect((yield* refusalOf(act(page, { action: 'click', ref: refIn(shot, /button "Ask"/) }))).code).toBe('dialog-open');
        yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: true }, undefined, agent));
        expect(yield* evaluate(page, 'document.getElementById("said").textContent')).toBe('yes');
      }),
    );

    it.effect('a navigation held by beforeunload waits for the answer: dismissed it fails and the page stays, accepted it leaves', () =>
      Effect.gen(function* () {
        const page = yield* open('/leave');
        yield* act(page, { action: 'type', ref: refIn(yield* snapshot(page), /textbox "Draft"/), text: 'unsaved' });
        const leave = () => Effect.forkChild(calling(PAGE.navigate_page.body.execute({ page, url: at('/second') }, undefined, agent)));
        const asked = Effect.gen(function* () {
          const pages = yield* Pages;
          const moves = yield* pages.moves(page);
          if (pages.live(page)?.dialog?.kind === 'beforeunload') return;
          yield* Stream.runHead(Stream.filter(moves, (move) => move.live.dialog?.kind === 'beforeunload'));
        });
        const stayed = yield* leave();
        yield* asked;
        yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: false }, undefined, agent));
        expect((yield* refusalOf(Fiber.join(stayed))).code).toBe('navigation-failed');
        expect(yield* evaluate(page, 'location.pathname')).toBe('/leave');
        const left = yield* leave();
        yield* asked;
        yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: true }, undefined, agent));
        expect((yield* Fiber.join(left)).page.url).toBe(at('/second'));
      }),
    );

    it.effect('a close held by beforeunload waits for the answer: dismissed the page stays open, accepted it closes', () =>
      Effect.gen(function* () {
        const page = yield* open('/leave');
        yield* act(page, { action: 'type', ref: refIn(yield* snapshot(page), /textbox "Draft"/), text: 'unsaved' });
        const closing = () => Effect.forkChild(calling(PAGE.close_page.body.execute({ page }, undefined, agent)));
        const standing = Effect.map(calling(PAGE.list_pages.body.execute({}, undefined, agent)), (listed) =>
          listed.pages.find((held) => held.id === page),
        );
        const asked = Effect.gen(function* () {
          const pages = yield* Pages;
          const moves = yield* pages.moves(page);
          if (pages.live(page)?.dialog?.kind === 'beforeunload') return;
          yield* Stream.runHead(Stream.filter(moves, (move) => move.live.dialog?.kind === 'beforeunload'));
        });
        const stayed = yield* closing();
        yield* asked;
        yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: false }, undefined, agent));
        expect((yield* refusalOf(Fiber.join(stayed))).code).toBe('page-stayed');
        expect(yield* evaluate(page, 'document.getElementById("draft").value')).toBe('unsaved');
        const closed = yield* closing();
        yield* asked;
        yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: true }, undefined, agent));
        expect((yield* Fiber.join(closed)).page).toBe(page);
        expect(yield* standing).toBeUndefined();
      }),
    );

    it.effect('a large snapshot respects its limit, a CPU-hung action and later snapshot refuse, and reload recovers the page', () =>
      Effect.gen(function* () {
        const held = yield* EnginePage;
        if (held.current !== undefined && (yield* Pages).live(held.current) !== undefined)
          yield* calling(PAGE.close_page.body.execute({ page: held.current }, undefined, agent));
        const page = yield* open('/heavy');
        const pages = yield* Pages;
        yield* Effect.addFinalizer(() => pages.close(page).pipe(Effect.orDie));
        yield* loaded(page);
        const shot = yield* calling(PAGE.snapshot_page.body.execute({ page, limit: 300 }, undefined, agent));
        expect([shot.shown, shot.more]).toEqual([300, true]);
        const ref = refIn(shot.text, /button "Spin"/);
        const acting = yield* Effect.forkChild(act(page, { action: 'click', ref }));
        yield* Deferred.await(spinning);
        yield* TestClock.adjust('6 seconds');
        expect((yield* refusalOf(Fiber.join(acting))).code).toBe('page-unresponsive');
        expect((yield* refusalOf(snapshot(page))).code).toBe('page-unresponsive');
        yield* calling(PAGE.navigate_page.body.execute({ page, go: 'reload' }, undefined, agent));
        expect(refIn(yield* snapshot(page), /button "Spin"/)).toMatch(/^e\d+$/);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    it.effect('a crashed renderer is published, refuses actions and recovers after reload', () =>
      Effect.gen(function* () {
        const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/second'), profile: input.profile }, undefined, OPERATOR));
        const page = opened.page.id;
        const pages = yield* Pages;
        yield* Effect.addFinalizer(() => pages.close(page).pipe(Effect.orDie));
        const moves = yield* pages.moves(page);
        const host = yield* pages.hold(page);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* host.pages.session(page);
            yield* session.post('Page.crash');
            if (!pages.live(page)?.crashed) yield* Stream.runHead(Stream.filter(moves, (move) => move.live.crashed));
          }),
        );
        const listed = yield* calling(PAGE.list_pages.body.execute({}, undefined, agent));
        expect(listed.pages.find((held) => held.id === page)?.live.crashed).toBe(true);
        expect((yield* refusalOf(snapshot(page))).code).toBe('page-crashed');
        expect((yield* refusalOf(act(page, { action: 'click', x: 20, y: 20 }))).code).toBe('page-crashed');
        yield* calling(PAGE.navigate_page.body.execute({ page, go: 'reload' }, undefined, agent));
        yield* loaded(page);
        expect(refIn(yield* snapshot(page), /heading "Second page"/)).toMatch(/^e\d+$/);
      }),
    );

    it.effect('a picked element is described with a ref that a click goes through', () =>
      Effect.gen(function* () {
        const page = yield* open('/pick');
        const automation = yield* Automation;
        const picking = yield* Scope.fork(yield* Scope.Scope);
        const stream = yield* Scope.provide(automation.pick(page), picking);
        const picked = yield* Effect.forkChild(Stream.runHead(stream));
        const rect = (yield* evaluate(
          page,
          '(() => { const box = document.getElementById("target").getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })()',
        )) as { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
        yield* act(page, { action: 'click', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
        const described = yield* Fiber.join(picked);
        yield* Scope.close(picking, Exit.void);
        expect(described._tag).toBe('Some');
        if (described._tag !== 'Some') return;
        expect(described.value.selector).toBe('#target');
        expect(described.value.role).toBe('button');
        yield* act(page, { action: 'click', ref: described.value.ref });
        expect(yield* evaluate(page, 'document.getElementById("target").textContent')).toBe('Clicked');
      }),
    );

    it.effect('a profile whose host is not connected, named or by default, refuses host-away and names the connected ones', () =>
      Effect.gen(function* () {
        const refused = yield* refusalOf(calling(PAGE.open_page.body.execute({ url: at('/second'), profile: ABSENT }, undefined, agent)));
        expect(refused.code).toBe('host-away');
        expect(refused.unblock.join(' ')).toContain(input.profile);
        if (input.adapter.seeds.some((seed) => seed.id === AGENT_PROFILE)) return;
        const unnamed = yield* refusalOf(calling(PAGE.open_page.body.execute({ url: at('/second') }, undefined, agent)));
        expect(unnamed.code).toBe('host-away');
        expect(unnamed.unblock.join(' ')).toContain(input.profile);
      }),
    );
  });
};
