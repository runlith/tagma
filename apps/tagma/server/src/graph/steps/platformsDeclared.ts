import { and, eq, sql } from 'drizzle-orm';
import { Clock, Effect, Schema } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { block } from '../store/tables.js';
import { askOnce } from '../tree/oneShot.js';
import { PlatformAnswer, type PlatformJob } from './platformsWire.js';

const stepping = writes('Tree.step.platformsDeclared', [block]);
const failed = (message: string) =>
  new GateRefusal('graph-pool', `the platforms graph step could not run: ${message}`, [
    'repair the reported failure, then open the graph again',
  ]);

export const platformsDeclared = Effect.fn('GraphStep.platformsDeclared')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db
    .select({ id: block.id, fields: block.fields })
    .from(block)
    .where(
      and(
        eq(block.projectId, project.id),
        sql`json_type(${block.fields}, '$.enforcement.checks') = 'array' and exists (
      select 1 from json_each(${block.fields}, '$.enforcement.checks') c
      where json_extract(case when c.type = 'object' then c.value else '{}' end, '$.builtin') in ('modules', 'loads', 'platforms')
    )`,
      ),
    );
  if (rows.length === 0) return;
  const job: PlatformJob = { root: project.rootPath, rows };
  const raw = yield* askOnce<unknown, GateRefusal<'graph-pool'>>(new URL('./platformsDeclared.worker.ts', import.meta.url), job, failed);
  const answer = yield* Schema.decodeUnknownEffect(PlatformAnswer)(raw).pipe(Effect.mapError((error) => failed(error.message)));
  if (answer.state === 'failed') return yield* failed(answer.message);
  if (answer.rows.length === 0) return;
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const one of answer.rows) yield* db.update(block).set({ fields: one.fields, updatedAt: now }).where(eq(block.id, one.id));
    }),
  );
});
