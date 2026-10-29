import { expect } from 'bun:test';
import { Deferred, Effect, Fiber, Queue, Stream } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { Automation } from '../contract/service/automation.js';
import { Pages } from '../contract/service/pages.js';
import { Screencast } from '../contract/service/screencast.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Picked } from '../contract/wire/pick.js';
import { browserChannels } from '../feeds.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import { neutral, pixelOf } from './pixels.js';
import { calling, OPERATOR, refIn, Seeded } from './world.js';

export const PICK_FRAME = `<!doctype html><body style="margin:0;background:white">
  <button id="frame-pick" style="position:absolute;left:20px;top:20px;width:160px;height:60px;background:#ddd;border:0"
    onclick="this.dataset.clicks = String(Number(this.dataset.clicks || 0) + 1); this.textContent = 'Clicked ' + this.dataset.clicks; fetch('/pick-through')">FRAME_NAME</button>
  <script>if (new URL(location.href).searchParams.has('nested')) { document.documentElement.style.overflow = 'hidden'; document.body.style.height = '1600px'; const url = new URL('/pick-frame?name=Deep%20frame', location.href); url.hostname = '127.0.0.1'; const frame = document.createElement('iframe'); frame.src = url; frame.style = 'position:absolute;left:0;top:1000px;width:300px;height:100px;border:0'; document.body.append(frame); }</script>`;

export const framePickScenario = Effect.fnUntraced(function* (input: {
  readonly page: PageId;
  readonly caller: Caller;
  readonly frameUrl: string;
  readonly through: Deferred.Deferred<void>;
}) {
  const { page, caller } = input;
  const automation = yield* Automation;
  const projectId = (yield* Seeded).id;
  const ready = yield* Deferred.make<void>();
  const descriptions = yield* Queue.unbounded<Picked>();
  const channels = browserChannels(
    yield* Pages,
    Automation.of({
      ...automation,
      pick: (...args) => automation.pick(...args).pipe(Effect.tap(() => Deferred.succeed(ready, undefined))),
    }),
    yield* Screencast,
  );
  const picking = yield* Effect.forkChild(
    Stream.runForEach(channels['browser.pick']({ projectId, page }), (picked) => Queue.offer(descriptions, picked)),
  );
  yield* Deferred.await(ready);
  const snapshot = () => calling(PAGE.snapshot_page.body.execute({ page }, undefined, caller));
  const act = (action: 'click' | 'hover', ref: string) =>
    calling(PAGE.act_on_page.body.execute({ page, steps: [{ action, ref }] }, undefined, caller));
  const described = Effect.raceFirst(Queue.take(descriptions), Effect.as(Deferred.await(input.through), null));
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `document.documentElement.insertAdjacentHTML('afterbegin', '<style>html { overflow:scroll } html::-webkit-scrollbar { width:16px; height:16px }</style>'); true`,
      },
      undefined,
      caller,
    ),
  );
  const first = refIn((yield* snapshot()).text, /button "First frame"/);
  yield* act('click', first);
  const initial = yield* described;
  expect(initial?.name).toBe('First frame');
  expect(initial?.selector).toBe('#frame-pick');
  expect(initial?.ref).toBe(first);
  if (initial === null) return;
  expect(initial.rect.x).toBe(100);
  expect(initial.rect.y).toBe(140);
  expect(initial.picture).not.toBeNull();
  if (initial.picture !== null) expect(neutral(yield* pixelOf(page, 'image/png', initial.picture, 12, 12))).toBe(true);

  yield* act('hover', first);
  const captured = yield* calling(PAGE.capture_page.body.execute({ page }, undefined, caller));
  const png = Buffer.from(yield* automation.picture(captured.path)).toString('base64');
  expect(neutral(yield* pixelOf(page, 'image/png', png, 112, 152))).toBe(true);
  yield* act('click', first);
  expect((yield* described)?.ref).toBe(first);

  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(() => { const frame = document.createElement('iframe'); frame.src = ${JSON.stringify(input.frameUrl)}; frame.style = 'position:absolute;left:80px;top:260px;width:300px;height:100px;border:0'; document.body.append(frame); return new Promise(resolve => frame.onload = resolve); })()`,
      },
      undefined,
      caller,
    ),
  );
  const later = refIn((yield* snapshot()).text, /button "Later frame"/);
  yield* act('click', later);
  expect((yield* described)?.ref).toBe(later);
  yield* Fiber.interrupt(picking);
  const rootClick = () =>
    calling(PAGE.act_on_page.body.execute({ page, steps: [{ action: 'click', x: 180, y: 310 }] }, undefined, OPERATOR));
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 1"/)).toBe(later);
  const element = yield* calling(PAGE.capture_page.body.execute({ page, what: 'element', ref: first }, undefined, caller));
  if (element.status !== 'captured') return yield* Effect.die('the element capture answered a heap');
  expect([element.width, element.height]).toEqual([160, 60]);
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 2"/)).toBe(later);
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `document.body.insertAdjacentHTML('beforeend', '<div role="button" aria-label="Large region" style="position:fixed;left:0;top:0;width:1200px;height:900px;background:white;z-index:-1"></div><div style="position:absolute;top:1800px;width:1px;height:100px"></div>'); true`,
      },
      undefined,
      caller,
    ),
  );
  const large = refIn((yield* snapshot()).text, /button "Large region"/);
  const oversized = yield* calling(PAGE.capture_page.body.execute({ page, what: 'element', ref: large }, undefined, caller));
  if (oversized.status !== 'captured') return yield* Effect.die('the element capture answered a heap');
  expect([oversized.width, oversized.height]).toEqual([1200, 900]);
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 3"/)).toBe(later);
  const full = yield* calling(PAGE.capture_page.body.execute({ page, what: 'full' }, undefined, caller));
  if (full.status !== 'captured') return yield* Effect.die('the full-page capture answered a heap');
  expect(full.height).toBeGreaterThanOrEqual(1900);
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 4"/)).toBe(later);
  yield* calling(PAGE.emulate_page.body.execute({ page, viewport: { width: 1024, height: 768, scale: 3 } }, undefined, caller));
  const dense = yield* calling(PAGE.capture_page.body.execute({ page, what: 'element', ref: first }, undefined, caller));
  if (dense.status !== 'captured') return yield* Effect.die('the element capture answered a heap');
  expect([dense.width, dense.height]).toEqual([480, 180]);
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 5"/)).toBe(later);
  yield* calling(PAGE.capture_page.body.execute({ page, what: 'full' }, undefined, caller));
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 6"/)).toBe(later);
  yield* calling(PAGE.emulate_page.body.execute({ page, clear: true }, undefined, caller));
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `document.body.insertAdjacentHTML('beforeend', '<div role="button" aria-label="Document region" style="position:absolute;left:0;top:1000px;width:1200px;height:900px;background:white"></div>'); true`,
      },
      undefined,
      caller,
    ),
  );
  const documentRegion = refIn((yield* snapshot()).text, /button "Document region"/);
  for (const captureFirst of [false, true]) {
    yield* calling(
      PAGE.act_on_page.body.execute({ page, steps: [{ action: 'scroll', ref: documentRegion, dx: 0, dy: 0 }] }, undefined, caller),
    );
    if (captureFirst) yield* calling(PAGE.capture_page.body.execute({ page, what: 'element', ref: documentRegion }, undefined, caller));
    yield* act('click', later);
    yield* rootClick();
    const after = yield* snapshot();
    expect(refIn(after.text, new RegExp(`button "Clicked ${captureFirst ? 10 : 8}"`))).toBe(later);
  }
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(() => { document.body.insertAdjacentHTML('beforeend', '<div id="nested-scroll" style="position:absolute;left:80px;top:1000px;width:300px;height:200px;overflow:auto;background:white"><button id="nested-target" style="display:block;position:relative;margin:0;width:160px;height:40px" onclick="this.dataset.clicks = String(Number(this.dataset.clicks || 0) + 1)">Nested root target</button><div style="height:1600px"></div></div>'); const box = document.querySelector('#nested-scroll'); const target = document.querySelector('#nested-target'); target.scrollIntoViewIfNeeded(); const offset = scrollY; scrollTo(0,0); box.scrollTop = offset; return { offset, y: target.getBoundingClientRect().y }; })()`,
      },
      undefined,
      caller,
    ),
  );
  const nested = refIn((yield* snapshot()).text, /button "Nested root target"/);
  yield* calling(PAGE.capture_page.body.execute({ page }, undefined, caller));
  yield* act('click', nested);
  const nestedClicks = yield* calling(
    PAGE.evaluate_in_page.body.execute(
      { page, expression: `Number(document.querySelector('#nested-target').dataset.clicks || 0)` },
      undefined,
      caller,
    ),
  );
  if (!('value' in nestedClicks)) return yield* Effect.die('the nested click count was not evaluated');
  expect(nestedClicks.value).toBe('1');
  yield* calling(
    PAGE.evaluate_in_page.body.execute(
      {
        page,
        expression: `(() => { scrollTo(0,0); const frame = document.querySelectorAll('iframe')[1]; frame.src = ${JSON.stringify(`${input.frameUrl}&nested=1`)}; return new Promise(resolve => frame.onload = resolve); })()`,
      },
      undefined,
      caller,
    ),
  );
  const deep = refIn((yield* snapshot()).text, /button "Deep frame"/);
  yield* calling(PAGE.capture_page.body.execute({ page }, undefined, caller));
  yield* act('click', deep);
  yield* rootClick();
  expect(refIn((yield* snapshot()).text, /button "Clicked 2"/)).toBe(deep);
});
