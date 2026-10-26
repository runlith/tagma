import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { bytesOf } from '@runlith/cdp/payload';
import type { Session } from '@runlith/cdp/session';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { Render } from '../artifacts/contract/service/render.js';
import { ArtifactStore } from '../artifacts/contract/service/shelf.js';
import { TIMELINE_DECLARATION, TIMELINE_FRAGMENT } from '../artifacts/contract/wire/fragment.js';
import { ARTIFACT_PAIRS } from '../artifacts/operations.js';
import { versionedShelf } from '../artifacts/testing/doubles.js';
import { Hosts } from '../browser/contract/service/hosts.js';
import { agentIn } from '../browser/testing/world.js';
import { managedFixture, testAdapter } from '../managed-browser/testing/host.js';
import type { GateRefusal } from '../platform/contract/wire/refusal.js';
import { renderLayer } from './layer.js';
import { stage } from './stage.js';

const FRAMES = ARTIFACT_PAIRS.read_artifact_frames.body;

const TIMELINE = { v: 1, duration: 6, fps: 30, width: 1920, height: 1080 } as const;

const scene = (script: string) =>
  `<!doctype html><html><head><title>Counter</title>${TIMELINE_DECLARATION}</head><body><div id="stage"><div id="face" style="width:100%;height:100%;font:200px sans-serif;color:#fff"></div></div><script>${script}</script>${TIMELINE_FRAGMENT}</body></html>`;

const paint = `const paint = (t) => {
  const k = Math.round(t * 30);
  const face = document.getElementById('face');
  face.style.background = 'rgb(' + (k * 20) % 256 + ', 40, 90)';
  face.textContent = String(k);
};`;

const COUNTER = scene(`${paint} window.render = paint;`);

const LATE = scene(`${paint} window.render = async (t) => { await new Promise((done) => setTimeout(done, 100)); paint(t); };`);

const BROKEN = scene(`throw new Error('the scene lost its palette');`);

const TEN_FRAMES =
  'new Promise((done) => { let n = 0; const next = () => (++n === 10 ? done(true) : requestAnimationFrame(next)); requestAnimationFrame(next); })';

const base64 = (html: string) => Buffer.from(html).toString('base64');

const shoot = (session: Session) => Effect.flatMap(session.reply('Page.captureScreenshot', { format: 'png' }), bytesOf);

const same = (left: Uint8Array, right: Uint8Array) => Buffer.from(left).equals(Buffer.from(right));

const world = Layer.mergeAll(
  renderLayer,
  Layer.effect(
    ArtifactStore,
    Effect.flatMap(FileSystem.FileSystem, (files) =>
      Effect.flatMap(files.makeTempDirectoryScoped({ prefix: 'page-render-shelf-' }), (root) =>
        versionedShelf(root, 'http://localhost:5634'),
      ),
    ),
  ),
).pipe(Layer.provideMerge(managedFixture()), Layer.provideMerge(BunFileSystem.layer));

layer(world, { excludeTestServices: true })('read_artifact_frames', (it) => {
  it.effect('draws frames of a draft at 960 px as pictures for the agent, publishing nothing, and refuses a page that throws', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'page-render-' });
      const draft = join(home, 'counter.html');
      yield* files.writeFileString(draft, COUNTER);
      const caller = agentIn(home);
      const answer = yield* FRAMES.execute({ path: draft, frames: [0, 90] }, undefined, caller);
      expect(answer.frames.map(({ k, width, height }) => ({ k, width, height }))).toEqual([
        { k: 0, width: 960, height: 540 },
        { k: 90, width: 960, height: 540 },
      ]);
      const pictures = yield* FRAMES.media!(answer);
      expect(pictures.map((picture) => picture.mediaType)).toEqual(['image/png', 'image/png']);
      expect(same(pictures[0]!.bytes, pictures[1]!.bytes)).toBe(false);
      expect((yield* (yield* ArtifactStore).list({ limit: 10 })).total).toBe(0);
      const terminal = { actor: { kind: 'operator' as const }, files: { path: home, resolve: (path: string) => join(home, path) } };
      const kept = yield* FRAMES.execute({ path: draft, frames: [0] }, undefined, terminal);
      expect(kept.frames[0]!.path.startsWith(home)).toBe(false);

      const past = (yield* Effect.flip(FRAMES.execute({ path: draft, frames: [179, 180] }, undefined, caller))) as GateRefusal;
      expect(past.code).toBe('frame-out-of-range');
      yield* files.writeFileString(draft, BROKEN);
      const broken = (yield* Effect.flip(FRAMES.execute({ path: draft, frames: [0] }, undefined, caller))) as GateRefusal;
      expect(broken.code).toBe('page-failed');
      expect(broken.reason).toContain('the scene lost its palette');
    }),
  );

  it.effect('a seek stops the page clock and an awaited render is shot drawn, in targets no page record shows', () =>
    Effect.gen(function* () {
      const host = (yield* Hosts).connected(testAdapter.id)!;
      const canvas = { width: 1920, height: 1080, scale: 0.25 };
      const counting = yield* host.capture!.target(canvas);
      const counter = yield* stage(counting, base64(COUNTER), { format: 'png' });
      const later = counting.send('Runtime.evaluate', { expression: TEN_FRAMES, awaitPromise: true });
      const running = yield* shoot(counting);
      yield* later;
      expect(same(yield* shoot(counting), running)).toBe(false);
      const drawn = yield* counter.draw(12 / 30);
      yield* later;
      expect(same(yield* shoot(counting), drawn)).toBe(true);

      const waiting = yield* host.capture!.target(canvas);
      const late = yield* stage(waiting, base64(LATE), { format: 'png' });
      expect(same(yield* late.draw(12 / 30), drawn)).toBe(true);
      expect(yield* host.pages.live).toEqual([]);

      const shots = yield* (yield* Render)
        .frames({ html: COUNTER, timeline: TIMELINE, frames: [1, 2, 3], scale: 0.25, image: { format: 'jpeg', quality: 90 }, targets: 2 })
        .pipe(Stream.runCollect);
      expect(shots.map((shot) => shot.k)).toEqual([1, 2, 3]);
      expect(yield* host.pages.live).toEqual([]);
    }),
  );
});
