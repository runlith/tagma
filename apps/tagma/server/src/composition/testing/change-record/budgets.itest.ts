import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Tracer } from 'effect';
import type { HoldingsChange } from '../../../change-record/contract/service/holdings.js';
import { budgetWorld, heldAt, layers, MINE, pathAt, prepareHead, threadIds } from './budgetWorld.js';

layer(layers, { excludeTestServices: true })('holdings boundaries', (it) => {
  it.effect('cold holdings publish partial state, retain bounded caches, and retire only the rows carried by a new HEAD', () => {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    return Effect.gen(function* () {
      const world = yield* budgetWorld({ tracked: 12, held: 12, primary: 2 });
      const opening = yield* world.judges.read(world.rootId).pipe(Effect.withTracer(tracer));
      expect(opening.state.kind).toBe('opening');
      expect(opening.paths.length).toBeLessThan(world.paths.length);
      const cold = yield* world.judges.judged(world.rootId, world.paths).pipe(Effect.withTracer(tracer));
      expect(cold.size).toBe(world.paths.length);
      expect([...cold.values()].every((row) => row.holding.verdict.verdict === 'proven')).toBe(true);
      const totals = yield* world.judges.threads(threadIds);
      expect(totals.size).toBe(10);
      expect(totals.get(MINE)?.paths).toBe(2);
      expect([...totals.values()].reduce((sum, total) => sum + total.paths, 0)).toBe(world.paths.length);
      for (const [bytes, budget] of [
        ['fold.cache.bytes', 'fold.cache.budget'],
        ['git.cache.bytes', 'git.cache.budget'],
      ]) {
        const retained = spans.filter((span) => span.attributes.has(bytes!));
        expect(retained.length).toBeGreaterThan(0);
        for (const span of retained) expect(Number(span.attributes.get(bytes!))).toBeLessThanOrEqual(Number(span.attributes.get(budget!)));
      }
      const before = yield* world.judges.read(world.rootId);
      const changes: HoldingsChange[] = [];
      const published = yield* Deferred.make<void>();
      const stop = world.judges.changed((change) =>
        Effect.andThen(
          Effect.sync(() => {
            changes.push(change);
          }),
          Deferred.succeed(published, undefined),
        ),
      );
      yield* Effect.addFinalizer(() => Effect.sync(stop));
      yield* world.files.writeFileString(`${world.root}/${pathAt(11)}`, `${heldAt(11)}external\n`);
      spans.length = 0;
      yield* world.judges.moved(world.rootId, [pathAt(11)]).pipe(Effect.withTracer(tracer));
      yield* Deferred.await(published);
      expect([...new Set(changes.flatMap((change) => change.changed.map((holding) => holding.path)))]).toEqual([pathAt(11)]);
      expect(changes.at(-1)!.revision).toBeGreaterThan(before.revision);
      const cached = spans.filter((span) => span.name === 'Git.objects');
      expect(cached.length).toBeGreaterThan(0);
      expect(cached.every((span) => span.attributes.get('git.blobs.read') === 0)).toBe(true);
      yield* world.retirement.pass(world.rootId);
      const next = yield* prepareHead(world, 2, 2);
      const updated = yield* world.git.run(['-C', world.root, 'update-ref', 'refs/heads/main', next, world.head]);
      expect(updated.status).toBe(0);
      const retired = yield* world.retirement.pass(world.rootId);
      expect([...retired.committed].sort()).toEqual(['budget-row-0', 'budget-row-1']);
      expect(retired.withdrawn).toEqual([]);
      yield* world.judges.moved(world.rootId, 'all');
      const after = yield* world.judges.judged(world.rootId, world.paths);
      for (const path of world.paths.slice(0, 2)) expect(after.get(path)?.holding.lines).toEqual({ added: 0, removed: 0 });
      expect(after.get(pathAt(2))?.holding.lines).toEqual({ added: 1, removed: 1 });
    });
  });
});
