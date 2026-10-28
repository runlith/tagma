import { expect } from 'bun:test';
import { Effect, Schema } from 'effect';
import { join } from 'node:path';
import { ios } from './ios.ts';

const page = `<!doctype html><title>Native fling proof</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}#list{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain}.row{height:80px;border-bottom:1px solid;box-sizing:border-box}#probe{position:fixed;left:20px;top:100px;width:120px;height:40px;z-index:1}</style><div id="list"></div><button id="probe">Tap target</button><textarea id="keyboard" style="position:fixed;left:20px;top:160px;width:120px;height:30px;z-index:1"></textarea><script>window.clicked=new Promise(resolve=>document.querySelector('#probe').addEventListener('click',event=>resolve(event.isTrusted),{once:true}));const list=document.querySelector('#list');for(let i=0;i<100;i++){const row=document.createElement('div');row.className='row';row.textContent='row '+i;list.append(row)}list.scrollTop=1000;</script>`;

ios.effect('MobileSafari preserves native momentum until a page write stops it', (phone) =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(page, { headers: { 'content-type': 'text/html' } }) }),
      ),
      (server) =>
        Effect.promise(async () => {
          await server.stop(true);
        }),
    );
    yield* Effect.promise(() =>
      Bun.write(
        join(phone.artifacts, 'simulator.json'),
        JSON.stringify({ udid: phone.udid, deviceSet: phone.deviceSet, runtime: phone.runtime, timing: phone.timing }),
      ),
    );
    yield* Effect.promise(() => phone.open(server.url.href));
    yield* Effect.promise(() => phone.open(`${server.url.href}#section`));
    yield* Effect.promise(() => phone.open(`${server.url.href}#section`));
    expect(yield* Effect.promise(() => phone.evaluate('location.hash', Schema.String))).toBe('#section');
    yield* Effect.promise(() =>
      phone.evaluate(
        '(() => { console.error(new Error("diagnostic only")); Promise.reject("diagnostic only"); return new Promise(resolve => requestAnimationFrame(() => resolve())); })()',
        Schema.Void,
      ),
    );
    expect(yield* Effect.promise(() => phone.evaluate('Promise.resolve(document.querySelector("#list").scrollTop)', Schema.Number))).toBe(
      1000,
    );
    const css = yield* Effect.promise(() =>
      phone.evaluate(
        '(() => { const r = document.querySelector("#probe").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()',
        Schema.Struct({ x: Schema.Number, y: Schema.Number }),
      ),
    );
    const screen = yield* Effect.promise(() => phone.pagePoint(css));
    yield* Effect.promise(() => Bun.write(join(phone.artifacts, 'mapped-tap.json'), JSON.stringify({ css, screen })));
    yield* Effect.promise(() => phone.tap(screen));
    expect(yield* Effect.promise(() => phone.evaluate('window.clicked', Schema.Boolean))).toBe(true);
    const baseline = yield* Effect.promise(() => phone.recording('#list'));
    yield* Effect.promise(() => phone.swipe({ from: { x: 200, y: 650 }, to: { x: 200, y: 200 } }));
    const native = yield* Effect.promise(() => baseline.result);
    yield* Effect.promise(() => Bun.write(join(phone.artifacts, 'native-fling.json'), JSON.stringify(native)));
    const release = native.release;
    expect(release).not.toBeNull();
    expect(native.touches.some((one) => one.type === 'touchend' && one.trusted)).toBe(true);
    expect(release!.velocity).toBeGreaterThan(0);
    const final = native.frames.at(-1)!;
    expect(final.offset - release!.offset).toBeGreaterThan(200);
    const moving = native.frames.filter((frame, i) => i > 0 && frame.t > release!.t && frame.offset !== native.frames[i - 1]!.offset);
    expect(moving.at(-1)!.t - release!.t).toBeGreaterThan(300);

    yield* Effect.promise(() =>
      phone.evaluate(
        `(async () => {
    await Promise.resolve();
    const list = document.querySelector('#list'); list.scrollTop = 1000;
    let released = null;
    list.addEventListener('touchend', () => { released = performance.now(); }, { once: true, passive: true });
    const write = () => {
      if (released === null || performance.now() - released < 100) return;
      list.removeEventListener('scroll', write);
      const before = list.scrollTop; list.scrollTop = before + 200;
      window.written = { t: performance.now(), target: before + 200 };
    };
    list.addEventListener('scroll', write, { passive: true });
  })()`,
        Schema.Void,
      ),
    );
    const interrupted = yield* Effect.promise(() => phone.recording('#list'));
    yield* Effect.promise(() => phone.swipe({ from: { x: 200, y: 650 }, to: { x: 200, y: 200 } }));
    const stopped = yield* Effect.promise(() => interrupted.result);
    yield* Effect.promise(() => Bun.write(join(phone.artifacts, 'interrupted-fling.json'), JSON.stringify(stopped)));
    const written = yield* Effect.promise(() =>
      phone.evaluate('window.written', Schema.Struct({ t: Schema.Number, target: Schema.Number })),
    );
    const afterWrite = stopped.frames.filter((one) => one.t > written.t);
    expect(afterWrite.length).toBeGreaterThan(2);
    if (Number(phone.runtime.split('.')[0]) === 26) {
      expect(afterWrite.every((one) => one.offset === written.target)).toBe(true);
    }
    const height = yield* Effect.promise(() => phone.evaluate('visualViewport.height', Schema.Number));
    const field = yield* Effect.promise(() =>
      phone.evaluate(
        '(() => { const r = document.querySelector("#keyboard").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()',
        Schema.Struct({ x: Schema.Number, y: Schema.Number }),
      ),
    );
    yield* Effect.promise(async () => phone.tap(await phone.pagePoint(field)));
    const shrunk = yield* Effect.promise(() =>
      phone.evaluate(
        `new Promise(resolve => {
    const view = visualViewport;
    const changed = () => { if (view.height < ${height}) { view.removeEventListener('resize', changed); resolve(view.height); } };
    view.addEventListener('resize', changed); changed();
  })`,
        Schema.Number,
      ),
    );
    expect(shrunk).toBeLessThan(height);
  }),
);
