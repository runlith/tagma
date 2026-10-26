import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Database } from 'bun:sqlite';
import { Deferred, Effect, Tracer } from 'effect';
import type { HoldingsChange } from '../../../change-record/contract/service/holdings.js';
import { budgetWorld, heldAt, pathAt, layers } from './budgetWorld.js';

layer(layers, { excludeTestServices: true })('incremental holdings', (it) => {
  it.effect('editing one of a thousand held paths publishes and judges only that path', () => {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    return Effect.gen(function* () {
      const world = yield* budgetWorld({ tracked: 1_000, held: 1_000 });
      yield* world.judges.judged(world.rootId, world.paths).pipe(Effect.withTracer(tracer));
      const queries = new Set(
        spans.flatMap((span) => {
          const text = span.attributes.get('db.query.text');
          return typeof text === 'string' && /\bfrom\s+"workspace_change"/i.test(text) ? [text] : [];
        }),
      );
      expect(queries.size).toBeGreaterThan(0);
      const db = new Database(world.store.path, { readonly: true });
      try {
        for (const query of queries) {
          const statement = db.query<{ detail: string }, (string | null)[]>(`EXPLAIN QUERY PLAN ${query}`);
          const plan = statement.all(...Array.from({ length: statement.paramsCount }, () => null));
          const accesses = plan.filter((step) => /\b(?:SEARCH|SCAN) workspace_change\b/.test(step.detail));
          expect(accesses.length).toBeGreaterThan(0);
          expect(accesses.every((step) => step.detail.startsWith('SEARCH '))).toBe(true);
        }
      } finally {
        db.close();
      }
      spans.length = 0;
      const before = yield* world.judges.read(world.rootId);
      expect(before.paths).toHaveLength(1_000);
      const changes: HoldingsChange[] = [];
      const published = yield* Deferred.make<void>();
      const unlisten = world.judges.changed((change) =>
        Effect.andThen(
          Effect.sync(() => {
            changes.push(change);
          }),
          Deferred.succeed(published, undefined),
        ),
      );
      yield* Effect.addFinalizer(() => Effect.sync(unlisten));
      yield* world.files.writeFileString(`${world.root}/${pathAt(0)}`, `${heldAt(0)}external\n`);
      yield* world.judges.moved(world.rootId, [pathAt(0)]).pipe(Effect.withTracer(tracer));
      yield* Deferred.await(published).pipe(Effect.timeout('2 seconds'));
      const after = yield* world.judges.read(world.rootId);
      expect(after.paths.find((holding) => holding.path === pathAt(0))?.lines).toEqual({ added: 2, removed: 1 });
      expect(changes).toHaveLength(1);
      expect(changes[0]?.revision).toBeGreaterThan(before.revision);
      expect(changes[0]?.changed.map((holding) => holding.path)).toEqual([pathAt(0)]);
      expect(changes[0]?.gone).toEqual([]);
      const judgments = spans.filter((span) => span.name === 'Holdings.judge');
      expect(judgments.reduce((paths, span) => paths + Number(span.attributes.get('holdings.paths')), 0)).toBe(1);
    });
  });
});
