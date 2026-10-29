import { afterAll, expect } from 'bun:test';
import { dirname } from 'node:path';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { Hosts } from '../contract/service/hosts.js';
import { Pages } from '../contract/service/pages.js';
import { Profiles } from '../contract/service/profiles.js';
import { PAGE_PAIRS as PAGE } from '../operations.js';
import type { EngineHost } from './scenarios.js';
import { agentIn, calling } from './world.js';

const LARGE_BYTES = 200 * 1024 * 1024;
const HTML = `<!doctype html><title>Heap</title><script>
window.HeapCanary = class HeapCanary { constructor(index) { this.index = index; this.slots = [index, index + 1]; } };
window.canaries = Array.from({length: 10000}, (_, i) => new HeapCanary(i));
</script>`;

export const heapScenarios = (input: EngineHost): void => {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(HTML, { headers: { 'content-type': 'text/html' } }),
  });
  afterAll(() => server.stop(true));
  const agent = agentIn(dirname(import.meta.path));
  layer(input.fixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
    `page heaps on ${input.name}`,
    (it) => {
      it.effect('heap captures count named instances, report growth, keep a large paused page and prune the fifth file', () =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const pages = yield* Pages;
          const opened = yield* calling(
            PAGE.open_page.body.execute({ url: `http://127.0.0.1:${server.port}/`, profile: input.profile }, undefined, agent),
          );
          const page = opened.page.id;
          yield* Effect.addFinalizer(() => pages.close(page).pipe(Effect.orDie));
          yield* calling(PAGE.wait_for_page.body.execute({ page, until: 'load', timeoutMs: 10_000 }, undefined, agent));
          const profile = yield* (yield* Profiles).record(input.profile);
          const host = yield* (yield* Hosts).reach(profile.adapter);
          const before = (yield* host.pages.live).find((held) => held.page === page)?.local;
          const capture = Effect.fnUntraced(function* () {
            const answer = yield* calling(PAGE.capture_page.body.execute({ page, what: 'heap', limit: 100 }, undefined, agent));
            if (answer.status !== 'heap') return yield* Effect.die(`capture_page heap answered ${answer.status}`);
            return answer;
          });
          const evaluate = (expression: string) => calling(PAGE.evaluate_in_page.body.execute({ page, expression }, undefined, agent));
          let allocated = false;
          yield* Effect.addFinalizer(() =>
            allocated
              ? Effect.andThen(evaluate('window.large = null; window.canaries = null; true'), capture()).pipe(Effect.asVoid, Effect.orDie)
              : Effect.void,
          );
          const first = yield* capture();
          expect(first.classes.find((held) => held.name === 'HeapCanary')?.count).toBe(10_000);
          expect(first.previous).toBeNull();
          expect(first.growth).toEqual([]);
          yield* evaluate('for (let i = 0; i < 5000; i++) canaries.push(new HeapCanary(i + 10000)); true');
          const second = yield* capture();
          expect(second.previous).toBe(first.path);
          expect(second.classes.find((held) => held.name === 'HeapCanary')).toMatchObject({ count: 15_000, countDelta: 5_000 });
          expect(second.growth.find((held) => held.name === 'HeapCanary')?.countDelta).toBe(5_000);
          expect(second.classCount).toBeGreaterThanOrEqual(second.classes.length);
          allocated = true;
          yield* evaluate(`window.large = new Array(${LARGE_BYTES / 8}).fill(0.5); large.length`);
          const large = yield* capture();
          yield* evaluate('window.large = null; canaries.splice(0, 5000); true');
          allocated = false;
          expect(large.sizeBytes).toBeGreaterThanOrEqual(LARGE_BYTES);
          expect(pages.live(page)?.responsive).toBe(true);
          expect((yield* host.pages.live).find((held) => held.page === page)?.local).toBe(before);
          console.log(`heap capture sample: ${large.sizeBytes} heap bytes; ${large.bytes} file bytes; ${large.pausedMs} ms pause hold`);
          const fourth = yield* capture();
          expect(fourth.classes.find((held) => held.name === 'HeapCanary')?.countDelta).toBe(-5_000);
          const fifth = yield* capture();
          expect(fifth.removed).toEqual([first.path]);
          expect(yield* files.exists(first.path)).toBe(false);
          expect(yield* files.exists(`${first.path}.json`)).toBe(false);
          const retained = (yield* files.readDirectory(dirname(fifth.path))).filter((name) => name.endsWith('.heapsnapshot'));
          expect(retained.length).toBe(4);
          expect(Number((yield* files.stat(fifth.path)).size)).toBe(fifth.bytes);
        }),
      );
    },
  );
};
