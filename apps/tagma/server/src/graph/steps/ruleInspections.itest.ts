import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { block, event } from '../store/tables.js';
import { ruleInspections } from './ruleInspections.js';

const HASH = 'a'.repeat(64);
const old = (checks: readonly object[], debt: readonly object[] = [], escaped: readonly object[] = []) => ({
  strictness: 'gate',
  on: [{ op: 'submit_work', phase: 'before' }],
  checks,
  debt,
  escaped,
});
const LOADS = { builtin: 'loads', params: { from: ['src'], refuses: ['react'] } };
const MODULES = { builtin: 'modules', params: {} };
const STYLE = { runner: 'law', id: 'effect-style', params: { forms: ['scope-run-sync'] } };

layer(demoGraphLayer(), { excludeTestServices: true })('rule inspections', (it) => {
  it.effect(
    'one-check documents name the id of their check, suffixed by the rule where rules share it, program fingerprints carry the key, and the journal documents follow',
    () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { graph, projectId } = demo;
          const { db } = graph.graphStore;
          const rule = (title: string) => graph.blocks.create({ projectId, tags: ['rule'], title });
          const [first, second, modules, style, both, trashed] = yield* Effect.forEach(
            ['first loads', 'second loads', 'modules', 'style', 'two checks', 'trashed modules'],
            rule,
          );
          const documents = new Map<number, object>([
            [first!.id, old([LOADS], [{ fingerprint: 'src/a.ts -> react', owner: 'deadbeef' }])],
            [second!.id, old([LOADS])],
            [modules!.id, old([MODULES])],
            [style!.id, old([STYLE], [{ fingerprint: `law:effect-style ${HASH} src/a.ts × run`, owner: 'deadbeef', value: 3 }])],
            [
              both!.id,
              old([MODULES, STYLE], [], [{ fingerprint: `modules ${HASH} app order a -> b`, path: 'a.ts', commit: 'c'.repeat(40) }]),
            ],
            [trashed!.id, old([MODULES])],
          ]);
          for (const [id, enforcement] of documents) yield* db.update(block).set({ fields: { enforcement } }).where(eq(block.id, id));
          yield* db
            .update(block)
            .set({ deletedAt: new Date(0) })
            .where(eq(block.id, trashed!.id));
          const [journaled] = yield* db
            .insert(event)
            .values({
              projectId,
              blockId: style!.id,
              ts: new Date(0),
              op: 'enforce',
              payload: JSON.stringify({ inspection: STYLE, was: old([STYLE]) }),
            })
            .returning();
          yield* ruleInspections(yield* graph.projects.byId(projectId));
          const fields = new Map(
            (yield* db
              .select({ id: block.id, fields: block.fields })
              .from(block)
              .where(inArray(block.id, [...documents.keys()]))).map((row) => [row.id, row.fields.enforcement]),
          );
          expect(fields.get(first!.id)).toEqual({
            strictness: 'gate',
            on: [{ op: 'submit_work', phase: 'before' }],
            inspection: `loads-${yield* demo.nameOf(first!.id)}`,
            debt: [{ fingerprint: 'src/a.ts -> react', owner: 'deadbeef' }],
            escaped: [],
          });
          expect(fields.get(second!.id)).toMatchObject({ inspection: `loads-${yield* demo.nameOf(second!.id)}` });
          expect(fields.get(modules!.id)).toMatchObject({ inspection: 'modules' });
          expect(fields.get(trashed!.id)).toMatchObject({ inspection: 'modules' });
          expect(fields.get(style!.id)).toMatchObject({
            inspection: 'effect-style',
            debt: [{ fingerprint: 'effect-style src/a.ts × run', owner: 'deadbeef', value: 3 }],
          });
          expect(fields.get(both!.id)).toMatchObject({
            inspection: `rule-${yield* demo.nameOf(both!.id)}`,
            escaped: [{ fingerprint: 'app order a -> b' }],
          });
          const [entry] = yield* db.select().from(event).where(eq(event.id, journaled!.id));
          expect(JSON.parse(entry!.payload)).toEqual({
            inspection: STYLE,
            was: { strictness: 'gate', on: [{ op: 'submit_work', phase: 'before' }], inspection: 'effect-style', debt: [], escaped: [] },
          });
        }),
      ),
  );
});
