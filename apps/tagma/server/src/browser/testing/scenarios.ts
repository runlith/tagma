import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Pages } from '../contract/service/pages.js';
import { Automation } from '../contract/service/automation.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { componentScenario } from './components.js';
import { type HostAdapter, Hosts } from '../contract/service/hosts.js';
import { Profiles } from '../contract/service/profiles.js';
import { AGENT_PROFILE, type PageId, ProfileId } from '../contract/wire/ids.js';
import { PAGE_PAIRS as PAGE, PROFILE_PAIRS as PROFILE } from '../operations.js';
import { neutral, pixelOf } from './pixels.js';
import { framePickScenario } from './picking.js';
import { engineSite } from './site.js';
import { agentIn, calling, loaded, OPERATOR, refIn, refusalOf, Seeded, type Served } from './world.js';

import { conditionScenario, refusedConditionScenario } from './conditions.js';
import { domainScenario } from './domains.js';

const ABSENT = ProfileId.make('absent-agent');

class EnginePage extends Context.Service<EnginePage, { current: Map<Scope.Scope, PageId> }>()('testing/EnginePage') {}

export type EngineHost = {
  readonly name: string;
  readonly adapter: HostAdapter;
  readonly profile: ProfileId;
  readonly rendererCpu: boolean;
  readonly fixture: () => Layer.Layer<Served | Hosts>;
};

export const engineScenarios = (input: EngineHost): void => {
  const { at, crossSite, domains, spinning, recover, recovering, childSpinning, pickThrough, frameOrigin } = engineSite();
  const home = mkdtempSync(join(tmpdir(), 'browser-engine-'));
  const world = Layer.effect(
    EnginePage,
    Effect.gen(function* () {
      const record = yield* (yield* Profiles).record(input.profile);
      const host = yield* (yield* Hosts).reach(record.adapter);
      yield* host.profiles.prepare(record);
      return EnginePage.of({ current: new Map() });
    }),
  ).pipe(Layer.provideMerge(input.fixture()), Layer.provideMerge(BunFileSystem.layer));
  const agent = agentIn(home);
  const open = Effect.fnUntraced(function* (path: string) {
    const held = yield* EnginePage;
    const pages = yield* Pages;
    const scope = yield* Effect.scope;
    const current = held.current.get(scope);
    if (current !== undefined && pages.live(current) !== undefined) {
      yield* calling(PAGE.navigate_page.body.execute({ page: current, url: at(path) }, undefined, agent));
      return current;
    }
    const opened = yield* calling(PAGE.open_page.body.execute({ url: at(path), profile: input.profile }, undefined, agent));
    const page = opened.page.id;
    held.current.set(scope, page);
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        held.current.delete(scope);
        if (pages.live(page) !== undefined) yield* pages.close(page).pipe(Effect.orDie);
      }),
    );
    return page;
  });
  const snapshot = (page: PageId) =>
    calling(PAGE.snapshot_page.body.execute({ page }, undefined, agent)).pipe(Effect.map((shot) => shot.text));
  const act = (page: PageId, action: Parameters<typeof PAGE.act_on_page.body.execute>[0]['steps'][number]) =>
    calling(PAGE.act_on_page.body.execute({ steps: [action], page }, undefined, agent));

  const slowed = Effect.fnUntraced(function* (page: PageId) {
    const pages = yield* Pages;
    yield* calling(PAGE.emulate_page.body.execute({ page, cpu: 20 }, undefined, agent));
    yield* Effect.addFinalizer(() =>
      pages.live(page) === undefined
        ? Effect.void
        : calling(PAGE.emulate_page.body.execute({ page, cpu: 1 }, undefined, agent)).pipe(Effect.asVoid, Effect.orDie),
    );
  });

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
        if (captured.status !== 'captured') return yield* Effect.die('the picture capture answered a heap');
        expect([captured.width, captured.height]).toEqual([900, 700]);
        const navigated = yield* calling(PAGE.navigate_page.body.execute({ page, url: at('/second') }, undefined, OPERATOR));
        expect(navigated.page.url).toBe(at('/second'));
        yield* loaded(page);
        expect(refIn(yield* snapshot(page), /heading "Second page"/)).toMatch(/^e\d+$/);
        expect((yield* refusalOf(act(page, { action: 'click', ref }))).code).toBe('stale-ref');
      }),
    );

    it.effect(
      'domain settings gate agent documents, redirects, frames and popups before any request, while operator navigation and page fetch remain free',
      () =>
        Effect.gen(function* () {
          const page = yield* open('/domains');
          yield* slowed(page);
          yield* domainScenario({
            page,
            profile: input.profile,
            url: at('/domains'),
            caller: agent,
            visits: domains.visits,
            reached: domains.reached,
          });
        }),
    );

    it.effect('one sequence fills dependent fields and submits in order', () =>
      Effect.gen(function* () {
        const page = yield* open('/sequence');
        const shot = yield* snapshot(page);
        const answer = yield* calling(
          PAGE.act_on_page.body.execute(
            {
              page,
              steps: [
                { action: 'fill', ref: refIn(shot, /textbox "Name"/), text: 'Ada' },
                { action: 'fill', ref: refIn(shot, /textbox "Code"/), text: '42' },
                { action: 'click', ref: refIn(shot, /button "Save"/) },
              ],
            },
            undefined,
            agent,
          ),
        );
        expect(answer).toMatchObject({ status: 'acted', completed: 3, stopped: null });
        expect(yield* evaluate(page, 'document.getElementById("saved").textContent')).toBe('["Ada","42"]');
      }),
    );

    it.effect('a sequence reports its first refusal and leaves later steps untouched', () =>
      Effect.gen(function* () {
        const page = yield* open('/sequence');
        const shot = yield* snapshot(page);
        const refused = yield* refusalOf(
          calling(
            PAGE.act_on_page.body.execute(
              {
                page,
                steps: [
                  { action: 'fill', ref: refIn(shot, /textbox "Name"/), text: 'Ada' },
                  { action: 'check', ref: refIn(shot, /textbox "Name"/) },
                  { action: 'fill', ref: refIn(shot, /textbox "Code"/), text: '42' },
                  { action: 'click', ref: refIn(shot, /button "Save"/) },
                ],
              },
              undefined,
              agent,
            ),
          ),
        );
        expect(refused.code).toBe('action-failed');
        expect(refused.reason).toContain('step 2 stopped after 1 completed');
        expect(
          yield* evaluate(
            page,
            '[document.getElementById("name").value, document.getElementById("code").value, document.getElementById("saved").textContent]',
          ),
        ).toEqual(['Ada', '', '']);
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
        console.error(
          `scrolled-probe ${input.name} paint`,
          JSON.stringify(
            yield* evaluate(
              page,
              'new Promise((done) => { let frames = 0; const tick = () => { frames += 1; requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => done(["frames in 2s", frames, document.visibilityState, innerWidth, innerHeight]), 2000); })',
            ),
          ),
        );
        const shot = yield* snapshot(page);
        expect(yield* evaluate(page, 'document.getElementById("flow").getBoundingClientRect().top >= innerHeight')).toBe(true);
        console.error(`scrolled-probe ${input.name} before flow click`);
        const flow = yield* Effect.result(act(page, { action: 'click', ref: refIn(shot, /button "Below the fold"/) }));
        console.error(`scrolled-probe ${input.name} after flow click`, JSON.stringify(flow));
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

    it.effect('a page whose frame is silent without CPU attribution closes without holding another page', () =>
      Effect.gen(function* () {
        const own = yield* open('/second');
        const opened = yield* calling(PAGE.open_page.body.execute({ url: at('/hung-frame'), profile: input.profile }, undefined, OPERATOR));
        const page = opened.page.id;
        const pages = yield* Pages;
        yield* Effect.addFinalizer(() => (pages.live(page) === undefined ? Effect.void : pages.close(page).pipe(Effect.orDie)));
        yield* Deferred.await(childSpinning);
        expect(refIn(yield* snapshot(own), /heading "Second page"/)).toMatch(/^e\d+$/);
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
        const console = yield* calling(
          PAGE.read_page_console.body.execute({ page, level: 'error', match: 'boom from the page' }, undefined, agent),
        );
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
        const ref = refIn(shot, /button "Ask"/);
        const asked = yield* calling(
          PAGE.act_on_page.body.execute(
            {
              page,
              steps: [
                { action: 'focus', ref },
                { action: 'click', ref },
                { action: 'press', key: 'Enter' },
              ],
            },
            undefined,
            agent,
          ),
        );
        expect(asked).toMatchObject({ status: 'acted', completed: 1, stopped: 2, page: { dialog: { kind: 'confirm' } } });
        expect((yield* refusalOf(act(page, { action: 'click', ref: refIn(shot, /button "Ask"/) }))).code).toBe('dialog-open');
        yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: true }, undefined, agent));
        expect(yield* evaluate(page, 'document.getElementById("said").textContent')).toBe('yes');
      }),
    );

    it.effect(
      'a navigation held by beforeunload of the page or its cross-site frame on a slowed renderer waits for the answer: dismissed it fails and the page stays, accepted it leaves',
      () =>
        Effect.gen(function* () {
          for (const path of ['/leave', '/leave-framed']) {
            const page = yield* open(path);
            if (path === '/leave-framed') yield* loaded(page);
            yield* act(page, { action: 'type', ref: refIn(yield* snapshot(page), /textbox "Draft"/), text: 'unsaved' });
            if (path === '/leave') yield* slowed(page);
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
            expect(yield* evaluate(page, 'location.pathname')).toBe(path);
            const left = yield* leave();
            yield* asked;
            yield* calling(PAGE.answer_page_dialog.body.execute({ page, accept: true }, undefined, agent));
            expect((yield* Fiber.join(left)).page.url).toBe(at('/second'));
          }
        }),
    );

    it.effect(
      'a close held by beforeunload on a slowed renderer waits for the answer: dismissed the page stays open, accepted it closes',
      () =>
        Effect.gen(function* () {
          const page = yield* open('/leave');
          yield* act(page, { action: 'type', ref: refIn(yield* snapshot(page), /textbox "Draft"/), text: 'unsaved' });
          yield* slowed(page);
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

    it.effect('a limited snapshot stays bounded, and silent actions recover through renderer facts or caller cancellation', () =>
      Effect.gen(function* () {
        const page = yield* open('/heavy');
        const pages = yield* Pages;
        const other = (yield* calling(
          PAGE.open_page.body.execute({ url: crossSite('/second'), profile: input.profile }, undefined, OPERATOR),
        )).page.id;
        yield* Effect.addFinalizer(() => (pages.live(other) === undefined ? Effect.void : pages.close(other).pipe(Effect.orDie)));
        yield* loaded(other);
        expect(refIn(yield* snapshot(other), /heading "Second page"/)).toMatch(/^e\d+$/);
        const moves = yield* pages.moves(page);
        const closed = yield* Deferred.make<void>();
        let crashed = false;
        yield* Stream.runForEach(moves, (move) =>
          Effect.gen(function* () {
            crashed ||= move.live.crashed;
            if (move.signal === 'closed') yield* Deferred.succeed(closed, undefined);
          }),
        ).pipe(Effect.forkScoped);
        yield* loaded(page);
        const shot = yield* calling(PAGE.snapshot_page.body.execute({ page, limit: 300 }, undefined, agent));
        expect([shot.shown, shot.more]).toEqual([300, true]);
        const ref = refIn(shot.text, /button "Spin"/);
        const acting = yield* Effect.forkChild(act(page, { action: 'click', ref }));
        yield* Deferred.await(spinning);
        if (input.rendererCpu) {
          expect((yield* refusalOf(Fiber.join(acting))).code).toBe('page-unresponsive');
          expect((yield* refusalOf(snapshot(page))).code).toBe('page-unresponsive');
        } else {
          yield* Fiber.interrupt(acting);
          expect(Exit.hasInterrupts(yield* Fiber.await(acting))).toBe(true);
          const reading = yield* Effect.forkChild(snapshot(page), { startImmediately: true });
          yield* Fiber.interrupt(reading);
          expect(Exit.hasInterrupts(yield* Fiber.await(reading))).toBe(true);
          const dropping = yield* pages.moves(page);
          const record = yield* (yield* Profiles).record(input.profile);
          yield* (yield* (yield* Hosts).reach(record.adapter)).profiles.remove(input.profile);
          yield* Stream.runHead(Stream.filter(dropping, (move) => move.signal === 'dropped'));
        }
        yield* Effect.all(
          [
            calling(PAGE.close_page.body.execute({ page }, undefined, agent)),
            calling(PAGE.close_page.body.execute({ page }, undefined, agent)),
          ],
          { concurrency: 'unbounded' },
        );
        yield* Deferred.await(closed);
        expect(crashed).toBe(input.rendererCpu);
        expect(refIn(yield* snapshot(other), /heading "Second page"/)).toMatch(/^e\d+$/);
        const fresh = yield* open('/second');
        expect(refIn(yield* snapshot(fresh), /heading "Second page"/)).toMatch(/^e\d+$/);
      }).pipe(
        Effect.onError(() =>
          Effect.gen(function* () {
            const record = yield* (yield* Profiles).record(input.profile);
            const host = yield* (yield* Hosts).reach(record.adapter);
            yield* host.profiles.remove(input.profile);
          }).pipe(Effect.orDie),
        ),
      ),
    );

    it.effect('closing a recovered page with a stale unresponsive mark preserves its same-renderer popup', () =>
      Effect.gen(function* () {
        const page = yield* open('/recovering');
        const pages = yield* Pages;
        yield* loaded(page);
        yield* Deferred.await(recovering);
        const changes = yield* pages.changes((yield* Seeded).id);
        const popup = yield* changes.pipe(
          Stream.filter((event) => event.type === 'put' && event.page.opener === page),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* evaluate(page, 'window.open("/recovering-peer"); true');
        const opened = yield* Fiber.join(popup);
        if (opened._tag === 'None' || opened.value.type !== 'put') return yield* Effect.die('the recovery popup never opened');
        expect(opened.value.disposition).toBe('tab');
        const peer = opened.value.page.id;
        yield* Effect.addFinalizer(() => (pages.live(peer) === undefined ? Effect.void : pages.close(peer).pipe(Effect.orDie)));
        yield* loaded(peer);
        expect(refIn(yield* snapshot(peer), /heading "Recovery peer"/)).toMatch(/^e\d+$/);
        const acting = yield* Effect.forkChild(act(page, { action: 'click', ref: refIn(yield* snapshot(page), /button "Spin"/) }));
        if (input.rendererCpu) expect((yield* refusalOf(Fiber.join(acting))).code).toBe('page-unresponsive');
        else {
          yield* Fiber.interrupt(acting);
          expect(Exit.hasInterrupts(yield* Fiber.await(acting))).toBe(true);
          yield* pages.mark(page, { responsive: false });
        }
        const host = yield* pages.hold(page);
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* host.pages.strain(page, { factor: 1, paused: true });
            recover();
            yield* calling(PAGE.close_page.body.execute({ page }, undefined, agent));
          }),
        );
        const moves = yield* pages.moves(peer);
        if (pages.live(peer)?.responsive === false)
          yield* Stream.runHead(Stream.filter(moves, (move) => move.live.responsive || move.live.crashed));
        expect(refIn(yield* snapshot(peer), /heading "Recovery peer"/)).toMatch(/^e\d+$/);
      }).pipe(Effect.ensuring(Effect.sync(recover))),
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
        const project = yield* (yield* Projects).byId((yield* Seeded).id);
        const stream = yield* Scope.provide(automation.pick(page, project.id), picking);
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
        expect(described.value.component).toBeUndefined();
        yield* act(page, { action: 'click', ref: described.value.ref });
        expect(yield* evaluate(page, 'document.getElementById("target").textContent')).toBe('Clicked');
      }),
    );

    it.effect('a capture taken while the pointer hovers a picking page and the picture of the pick show no pick highlight', () =>
      Effect.gen(function* () {
        const page = yield* open('/pick');
        const automation = yield* Automation;
        const picking = yield* Scope.fork(yield* Scope.Scope);
        const project = yield* (yield* Projects).byId((yield* Seeded).id);
        const picked = yield* Effect.forkChild(Stream.runHead(yield* Scope.provide(automation.pick(page, project.id), picking)));
        const rect = (yield* evaluate(
          page,
          '(() => { const box = document.getElementById("target").getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; })()',
        )) as { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
        const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        yield* act(page, { action: 'hover', ...middle });
        const captured = yield* automation.capture(page, 'viewport', undefined, 'agent');
        const png = Buffer.from(captured.bytes).toString('base64');
        expect(neutral(yield* pixelOf(page, 'image/png', png, Math.round(rect.x + 12), Math.round(rect.y + 12)))).toBe(true);
        yield* act(page, { action: 'click', ...middle });
        const described = yield* Fiber.join(picked);
        const picture = described._tag === 'Some' ? described.value.picture : null;
        expect(typeof picture).toBe('string');
        if (picture === null) return;
        expect(neutral(yield* pixelOf(page, 'image/png', picture, 12, 12))).toBe(true);
        yield* Scope.close(picking, Exit.void);
      }),
    );

    it.effect(
      'cross-site frame picks survive captures, include frames attached later and end with their feed, and the page picks again after leaving them',
      () =>
        Effect.gen(function* () {
          const page = yield* open('/pick-frames');
          yield* loaded(page);
          yield* framePickScenario({ page, caller: agent, frameUrl: crossSite('/pick-frame?name=Later%20frame'), through: pickThrough });
          yield* open('/pick');
          const automation = yield* Automation;
          const described = yield* Effect.scoped(
            Effect.gen(function* () {
              const picked = yield* Effect.forkChild(Stream.runHead(yield* automation.pick(page, (yield* Seeded).id)));
              yield* act(page, { action: 'click', ref: refIn(yield* snapshot(page), /button "Pick me"/) });
              return yield* Fiber.join(picked);
            }),
          );
          expect(described._tag === 'Some' ? described.value.selector : null).toBe('#target');
        }),
    );

    it.effect('a dev pick reads main-world component locations and resolves only existing checkout files', () =>
      Effect.gen(function* () {
        const page = yield* open('/pick-dev');
        yield* loaded(page);
        yield* componentScenario({ page, caller: agent, frameOrigin });
      }),
    );

    it.effect('a refused combined condition change leaves layout emulation clearable', () =>
      refusedConditionScenario(input.profile, agent),
    );

    it.effect('load conditions slow every renderer, emulate network and location, and end with their run', () =>
      Effect.gen(function* () {
        const page = yield* open('/benchmark');
        yield* loaded(page);
        yield* conditionScenario({ page, profile: input.profile, url: at('/benchmark'), caller: agent });
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
