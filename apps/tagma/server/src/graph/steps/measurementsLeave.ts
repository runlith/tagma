import { Clock, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { block } from '../store/tables.js';

const stepping = writes('Tree.step.measurementsLeave', [block]);

const LEFT = ['baseline', 'measured'] as const;

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const enforcing = (value: unknown): value is Raw =>
  isRecord(value) && Array.isArray(value.checks) && LEFT.some((key) => Object.hasOwn(value, key));

const without = (value: Raw): Raw =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !(LEFT as readonly string[]).includes(key)));

export const measurementsLeave = Effect.fn('GraphStep.measurementsLeave')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db.select({ id: block.id, fields: block.fields }).from(block).where(eq(block.projectId, project.id));
  const moved = rows.flatMap((row) =>
    Object.values(row.fields).some(enforcing)
      ? [
          {
            id: row.id,
            fields: Object.fromEntries(
              Object.entries(row.fields).map(([name, value]) => [name, enforcing(value) ? without(value) : value]),
            ),
          },
        ]
      : [],
  );
  if (moved.length === 0) return;
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const row of moved) yield* db.update(block).set({ fields: row.fields, updatedAt: now }).where(eq(block.id, row.id));
    }),
  );
});
