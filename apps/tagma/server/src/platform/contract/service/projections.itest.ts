import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { SQLiteDialect, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Context, Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql/SqlClient';
import type { RowCommit } from '@runlith/sqlite-process/channel';
import { RowCommits, sqliteProcessLayer } from '@runlith/sqlite-process/SqliteProcess';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { nullableColumn, projectRows, selectRows } from './projections.js';

const node = sqliteTable('node', { id: text('id').primaryKey(), parent: text('parent'), label: text('label').notNull() });
const nodeRows = projectRows({
  id: 'node',
  table: node,
  keys: ['id'],
  address: 'id',
  columns: { id: node.id, parent: node.parent, label: node.label },
});
const labelled = selectRows({
  id: 'node.labelled',
  columns: { label: node.label, parent: nullableColumn(node.parent) },
  query: (key) => sql`select ${node.label} as label, ${node.parent} as parent from ${node} where ${node.id} = ${key}`,
  sources: [{ rows: nodeRows, columns: ['id', 'parent', 'label'] }],
});

it.live('a selection over its outer query’s own table reads each key its own row, the value its seal answered', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      sqliteProcessLayer({ filename: ':memory:', onLost: () => undefined, projectionWrite: () => 'effects' }, yield* sharedPool),
    );
    const client = Context.get(context, SqlClient);
    const rows = Context.get(context, RowCommits);
    yield* client`CREATE TABLE node (id TEXT PRIMARY KEY, parent TEXT, label TEXT NOT NULL)`;
    yield* rows.install([nodeRows.raw], [labelled.raw]);
    const commits: RowCommit[] = [];
    const stop = rows.listen((commit) => commits.push(commit));
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    yield* client.withTransaction(client`INSERT INTO node VALUES ('a', NULL, 'first'), ('b', 'a', 'second')`);
    const [commit] = commits;
    const sealed = Object.fromEntries(commit?._tag === 'Complete' ? commit.selected.map((row) => [row.key, row.values]) : []);

    const read = new SQLiteDialect().sqlToQuery(
      sql`select ${node.id} as id, ${labelled.encoded(node.id)} as selected from ${node} order by ${node.id}`,
    );
    const answered = yield* client.unsafe<{ readonly id: string; readonly selected: string }>(read.sql, read.params);
    const values = Object.fromEntries(answered.map((row) => [row.id, JSON.parse(row.selected)]));

    expect(values).toEqual({ a: { label: 'first', parent: null }, b: { label: 'second', parent: 'a' } });
    expect(sealed).toEqual(values);
  }),
);
