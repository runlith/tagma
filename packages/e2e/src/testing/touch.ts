import { expect } from 'bun:test';
import { Effect, Schema } from 'effect';
import type { Session } from '../engines.ts';
import type { IOSSession } from '../lanes/ios.ts';
import { makeTouch, TouchFailed, type PagePoint } from '../touch.ts';

type Fixture = Session | IOSSession;
const Events = Schema.Array(Schema.Struct({ type: Schema.String, trusted: Schema.Boolean, identifier: Schema.Number }));
const Held = Schema.Struct({ active: Schema.Number, mounted: Schema.Boolean });

export const proveTouch = Effect.fn('e2e.proveTouch')(function* (fixture: Fixture) {
  const touch = fixture.touch;
  if (touch === undefined) return yield* new TouchFailed({ message: 'this conformance requires a touch-capable context' });
  const evaluate = <A>(expression: string, schema: Schema.Decoder<A>): Promise<A> =>
    'evaluate' in fixture
      ? fixture.evaluate(expression, schema)
      : fixture.page.evaluate(expression).then((value) => Schema.decodeUnknownSync(schema)(value));
  yield* Effect.promise(async () => {
    await evaluate(
      `(() => {
    const element = document.querySelector('#list');
    const events = [], types = ['touchstart','touchmove','touchend','touchcancel'];
    let active = 0;
    const observe = event => {
      active = event.touches.length;
      events.push({type:event.type,trusted:event.isTrusted,identifier:event.changedTouches[0].identifier});
    };
    for (const type of types) element.addEventListener(type, observe, {passive:true});
    window.heldTouch = {
      events,
      get active() { return active; },
      wait: (type, count) => new Promise((resolve, reject) => {
        const clean = () => { element.removeEventListener(type, changed); element.removeEventListener('touchcancel', cancelled); };
        const changed = () => { if (events.filter(one => one.type === type).length >= count) { clean(); resolve(); } };
        const cancelled = () => { clean(); reject(new Error('the held contact was cancelled')); };
        element.addEventListener(type, changed, {passive:true});
        element.addEventListener('touchcancel', cancelled, {passive:true});
        if (events.some(one => one.type === 'touchcancel')) cancelled(); else changed();
      }),
      mount: () => new Promise(resolve => {
        const marker = document.createElement('span'); marker.textContent = 'Mounted under contact'; element.append(marker);
        requestAnimationFrame(() => resolve({active,mounted:marker.isConnected}));
      }),
      stop: () => { for (const type of types) element.removeEventListener(type, observe); }
    };
  })()`,
      Schema.Void,
    );
    await touch.press({ x: 200, y: 500 });
    await evaluate('heldTouch.wait("touchstart", 1)', Schema.Void);
    await touch.move({ x: 200, y: 420 });
    await evaluate('heldTouch.wait("touchmove", 1)', Schema.Void);
    const held = await evaluate('heldTouch.mount()', Held);
    expect(held.active).toBe(1);
    expect(held.mounted).toBe(true);
    await touch.move({ x: 200, y: 340 });
    await evaluate('heldTouch.wait("touchmove", 2)', Schema.Void);
    await touch.release();
    await evaluate('heldTouch.wait("touchend", 1)', Schema.Void);
    const events = await evaluate('heldTouch.events', Events);
    expect(events.filter((one) => one.type === 'touchstart').length).toBe(1);
    expect(events.filter((one) => one.type === 'touchend').length).toBe(1);
    expect(events.filter((one) => one.type === 'touchcancel').length).toBe(0);
    expect(events.filter((one) => one.type === 'touchmove').length).toBeGreaterThanOrEqual(2);
    expect(events.every((one) => one.trusted)).toBe(true);
    expect(new Set(events.map((one) => one.identifier)).size).toBe(1);
  });
  const leaving = new Error('leave the touch scope with its finger still down');
  yield* Effect.scoped(
    Effect.gen(function* () {
      const scoped = yield* makeTouch<PagePoint>({
        locate: async (point) => point,
        send: async (phase, point) => {
          if (phase === 'release') await touch.release();
          else await touch[phase](point);
        },
      });
      yield* Effect.promise(() => scoped.press({ x: 200, y: 500 }));
      yield* Effect.promise(() => evaluate('heldTouch.wait("touchstart", 2)', Schema.Void));
      expect(yield* Effect.promise(() => evaluate('heldTouch.active', Schema.Number))).toBe(1);
      return yield* Effect.fail(leaving);
    }),
  ).pipe(
    Effect.catchIf(
      (cause) => cause === leaving,
      () => Effect.void,
    ),
  );
  yield* Effect.promise(() => evaluate('heldTouch.wait("touchend", 2)', Schema.Void));
  expect(yield* Effect.promise(() => evaluate('heldTouch.active', Schema.Number))).toBe(0);
  const released = yield* Effect.promise(() => evaluate('heldTouch.events', Events));
  expect(released.at(-1)?.trusted).toBe(true);
  yield* Effect.promise(() => evaluate('(() => { heldTouch.stop(); document.querySelector("#list").scrollTop = 1000; })()', Schema.Void));
});
