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
import { calling, refIn, Seeded } from './world.js';

export const PICK_FRAME = `<!doctype html><body style="margin:0;background:white">
  <button id="frame-pick" style="position:absolute;left:20px;top:20px;width:160px;height:60px;background:#ddd;border:0"
    onclick="fetch('/pick-through')">FRAME_NAME</button>`;

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
  yield* act('click', later);
  yield* Deferred.await(input.through);
});
