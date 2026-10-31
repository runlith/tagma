import { and, eq, inArray, type SQLWrapper, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { session } from '../../platform/store/writers.js';
import { pagesOf } from '../../platform/store/binds.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Tags } from '../contract/service/vocabulary.js';
import { block, edge, event, farEdge, touch } from '../store/tables.js';
import { sessionFields } from '../tree/sessions.js';

const stepping = writes('Tree.step.sessionNamespace', [session, block, edge, event, farEdge, touch]);
const payload = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

export const sessionNamespace = Effect.fn('GraphStep.sessionNamespace')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const old = yield* db.select().from(session).where(eq(session.harness, 'lode'));
  if (old.length === 0) return;
  const fieldsOf = sessionFields(yield* (yield* Tags).of(project.id));
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const native = new Map<string, number>();
      for (const page of pagesOf(
        old.map((row) => row.key),
        1,
      )) {
        const rows = yield* db
          .select({ id: session.id, key: session.key })
          .from(session)
          .where(and(eq(session.harness, NATIVE_HARNESS), inArray(session.key, page)));
        for (const row of rows) native.set(row.key, row.id);
      }
      const moved = new Map<number, number>();
      for (const row of old) {
        const id = native.get(row.key);
        if (id !== undefined) moved.set(row.id, id);
      }
      for (const page of pagesOf(
        old.filter((row) => !moved.has(row.id)).map((row) => row.id),
        1,
      )) {
        yield* db.update(session).set({ harness: NATIVE_HARNESS }).where(inArray(session.id, page));
      }
      if (moved.size === 0) return;
      const rewrite = (tags: readonly string[], fields: Record<string, unknown>) => {
        let changed = false;
        const next = { ...fields };
        for (const name of fieldsOf({ tags })) {
          const value = fields[name];
          const id = typeof value === 'number' ? moved.get(value) : undefined;
          if (id !== undefined) {
            next[name] = id;
            changed = true;
          }
        }
        return changed ? next : null;
      };
      const rows = yield* db
        .select({ id: block.id, tags: block.tags, fields: block.fields })
        .from(block)
        .where(eq(block.projectId, project.id));
      for (const row of rows) {
        const fields = rewrite(row.tags, row.fields);
        if (fields !== null) yield* db.update(block).set({ fields }).where(eq(block.id, row.id));
      }
      const prior = yield* db
        .select({ id: event.id, payload: event.payload, tags: block.tags })
        .from(event)
        .innerJoin(block, eq(event.blockId, block.id))
        .where(
          and(
            eq(event.projectId, project.id),
            eq(event.op, 'update'),
            sql`json_valid(${event.payload}) and json_type(${event.payload}, '$.wasFields') = 'object'`,
          ),
        );
      for (const row of prior) {
        const value = yield* Schema.decodeUnknownEffect(payload)(row.payload).pipe(Effect.orDie);
        const tags =
          Array.isArray(value.wasTags) && value.wasTags.every((tag): tag is string => typeof tag === 'string') ? value.wasTags : row.tags;
        const fields = rewrite(tags, value.wasFields as Record<string, unknown>);
        if (fields !== null)
          yield* db
            .update(event)
            .set({ payload: JSON.stringify({ ...value, wasFields: fields }) })
            .where(eq(event.id, row.id));
      }
      yield* db.run(sql`create temporary table writer_move (old_id integer primary key, new_id integer not null)`);
      for (const page of pagesOf([...moved], 2))
        yield* db.run(
          sql`insert into temp.writer_move (old_id, new_id) values ${sql.join(
            page.map(([oldId, newId]) => sql`(${oldId}, ${newId})`),
            sql`, `,
          )}`,
        );
      const ids = sql`(select old_id from temp.writer_move)`;
      const next = (column: SQLWrapper) => sql`(select new_id from temp.writer_move where old_id = ${column})`;
      yield* db
        .update(edge)
        .set({ createdBySessionId: next(edge.createdBySessionId) })
        .where(inArray(edge.createdBySessionId, ids));
      yield* db
        .update(farEdge)
        .set({ createdBySessionId: next(farEdge.createdBySessionId) })
        .where(inArray(farEdge.createdBySessionId, ids));
      yield* db
        .update(event)
        .set({ sessionId: next(event.sessionId) })
        .where(inArray(event.sessionId, ids));
      yield* db
        .update(touch)
        .set({ sessionId: next(touch.sessionId) })
        .where(inArray(touch.sessionId, ids));
      yield* db.delete(session).where(inArray(session.id, ids));
      yield* db.run(sql`drop table temp.writer_move`);
    }),
  );
});
