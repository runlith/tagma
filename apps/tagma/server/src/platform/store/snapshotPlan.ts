import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Effect } from 'effect';
import { SnapshotFailed, type SnapshotMigration } from '../contract/service/snapshots.js';
import { isExternalContent, schemaStatement, statementTarget, triggerShape } from './statementTarget.js';
import { schemaRewrites, type SchemaTable } from './schemaRewrites.js';
import type { SnapshotObject, SnapshotTable } from './snapshotCopies.js';
import { snapshotWitness, type SnapshotWitnessTable } from './snapshotWitness.js';

export type SnapshotPlan = {
  readonly tables: readonly SnapshotTable[];
  readonly objects: readonly SnapshotObject[];
  readonly rebuilt: readonly string[];
  readonly pageSize: number;
  readonly witnesses: readonly SnapshotWitnessTable[];
};

type CatalogRow = { type: string; name: string; table: string; definition: string | null };

type Column = { name: string; type: string; pk: number; hidden: number };
type Reached = { data: boolean; added: Set<string> };

export const snapshotPlan = Effect.fn('Store.snapshotPlan')(
  function* (db: EffectSQLiteBunDatabase, path: string, pending: readonly SnapshotMigration[]) {
    const catalog = yield* db.all<CatalogRow>(sql`select type, name, tbl_name as "table", sql as definition from sqlite_master`);
    const existing = new Map(catalog.filter((row) => row.type === 'table').map((row) => [row.name.toLowerCase(), row]));
    const listed = yield* db.all<{ name: string; type: string }>(sql`select name, type from pragma_table_list where schema = 'main'`);
    const kinds: SchemaTable[] = [];
    for (const table of listed) {
      if (table.type !== 'virtual' && table.type !== 'shadow') continue;
      const columns =
        table.type === 'virtual'
          ? (yield* db.all<{ name: string }>(sql`select name from pragma_table_xinfo(${table.name})`)).map((column) => column.name)
          : [];
      kinds.push({ name: table.name, kind: table.type === 'virtual' ? 'virtual' : 'shadow', columns });
    }
    const virtual = new Set(kinds.filter((table) => table.kind === 'virtual').map((table) => table.name.toLowerCase()));
    const mirrors = new Map(
      catalog
        .filter(
          (row) =>
            row.type === 'table' && virtual.has(row.name.toLowerCase()) && row.definition !== null && isExternalContent(row.definition),
        )
        .map((row) => [row.name.toLowerCase(), row.name]),
    );
    const rebuilt = new Set<string>();
    const objects = new Map(
      catalog.filter((row) => ['index', 'trigger', 'view'].includes(row.type)).map((row) => [`${row.type}:${row.name.toLowerCase()}`, row]),
    );
    const reached = new Map<string, Reached>();
    const changedObjects = new Map<string, { name: string; type: 'index' | 'trigger' | 'view' }>();
    const changeObject = (name: string, type: 'index' | 'trigger' | 'view') =>
      changedObjects.set(`${type}:${name.toLowerCase()}`, { name, type });
    const temporary = new Set<string>();
    const renames: { readonly from: string; readonly to: string; readonly legacy: boolean }[] = [];
    const triggers = new Map<string, { table: string; on: ReturnType<typeof triggerShape>; body: readonly string[] }>();
    const refuse = (reason: string): never => {
      throw new SnapshotFailed({ path, reason });
    };
    const [pragmas] = yield* db.all<{ legacy: number; keys: number }>(
      sql`select legacy_alter_table as legacy, foreign_keys as keys from pragma_legacy_alter_table, pragma_foreign_keys`,
    );
    if (pragmas === undefined) return refuse('the connection answered no alter-table and foreign-key settings to copy');
    let legacy = pragmas.legacy === 1;
    const touch = (name: string, data = false) => {
      if (name.includes('.') || name.startsWith('sqlite_')) return refuse(`migration snapshot cannot cover table ${name}`);
      const entry = reached.get(name) ?? { data: false, added: new Set<string>() };
      entry.data ||= data;
      reached.set(name, entry);
      return entry;
    };
    const recordTrigger = (definition: string) => {
      const parsed = schemaStatement(definition);
      if (parsed.kind !== 'create-trigger') return refuse('migration snapshot cannot resolve an affected trigger');
      triggers.set(parsed.trigger, { table: parsed.table, on: triggerShape(definition), body: parsed.body });
    };
    for (const row of catalog) if (row.type === 'trigger' && row.definition !== null) recordTrigger(row.definition);
    const visits = new Set<string>();
    const written = (statement: string): boolean => {
      const target = statementTarget(statement);
      if (target.kind !== 'write') return false;
      const key = `${target.verb}:${target.table}:${target.columns === 'all' ? '*' : [...target.columns].sort().join(',')}:${target.replacing}:${target.updating}`;
      if (visits.has(key)) return true;
      visits.add(key);
      if (mirrors.has(target.table)) rebuilt.add(mirrors.get(target.table)!);
      else if (!temporary.has(target.table)) {
        const current = reached.get(target.table);
        const onlyAdded =
          target.verb === 'update' &&
          !target.replacing &&
          target.columns !== 'all' &&
          current !== undefined &&
          [...target.columns].every((column) => current.added.has(column));
        touch(target.table, !onlyAdded);
      }
      const verbs = new Set([target.verb, ...(target.replacing ? ['delete'] : []), ...(target.updating ? ['update'] : [])]);
      for (const trigger of triggers.values()) {
        if (trigger.table !== target.table || (trigger.on.on !== null && !verbs.has(trigger.on.on))) continue;
        if (
          trigger.on.of !== null &&
          target.columns !== 'all' &&
          ![...trigger.on.of].some((column) => target.columns === 'all' || target.columns.has(column))
        )
          continue;
        for (const body of trigger.body) {
          if (!written(body) && schemaStatement(body).kind !== 'other')
            refuse(`migration snapshot cannot cover a trigger on ${target.table}`);
        }
      }
      return true;
    };
    for (const migration of pending) {
      for (const statement of migration.sql) {
        visits.clear();
        if (written(statement)) continue;
        const target = schemaStatement(statement);
        if (target.kind === 'other') continue;
        if (target.kind === 'legacy-alter') {
          legacy = target.on;
          continue;
        }
        if (target.kind === 'unresolved') return refuse(`migration ${migration.name} has a statement whose snapshot target is unresolved`);
        if (target.kind === 'create-table') {
          if (target.temporary) {
            if (existing.has(target.table) || reached.has(target.table))
              return refuse(`temporary table ${target.table} shadows a persistent snapshot target`);
            temporary.add(target.table);
          } else {
            if (temporary.has(target.table)) return refuse(`migration snapshot cannot cover table ${target.table}`);
            touch(target.table);
          }
        } else if (target.kind === 'drop-table') {
          if (target.temporary || temporary.has(target.table)) temporary.delete(target.table);
          else touch(target.table, true);
          for (const [name, trigger] of triggers) if (trigger.table === target.table) triggers.delete(name);
        } else if (target.kind === 'alter-table') {
          if (target.temporary || temporary.has(target.table)) {
            if (target.renameTo !== null) {
              temporary.delete(target.table);
              temporary.add(target.renameTo);
            }
            continue;
          }
          if (target.renameTo !== null) {
            renames.push({ from: target.table, to: target.renameTo, legacy });
            continue;
          }
          const entry = touch(target.table, target.addedColumn === null);
          if (target.addedColumn !== null) entry.added.add(target.addedColumn);
        } else if (target.kind === 'create-trigger') {
          recordTrigger(statement);
          if (!target.temporary) changeObject(target.trigger, 'trigger');
        } else if (target.kind === 'drop-trigger') {
          triggers.delete(target.trigger);
          if (!target.temporary) changeObject(target.trigger, 'trigger');
        } else if (target.kind === 'create-index' || target.kind === 'drop-index') {
          if (!target.temporary) changeObject(target.index, 'index');
        } else if (!target.temporary) changeObject(target.view, 'view');
      }
    }
    const named = (name: string) => renames.filter((rename) => rename.from === name || rename.to === name).length;
    const renamed = new Map<string, string>();
    for (const { from, to, legacy: kept } of renames) {
      const alone =
        kept &&
        existing.has(from) &&
        !existing.has(to) &&
        !virtual.has(from) &&
        !reached.has(from) &&
        !reached.has(to) &&
        named(from) === 1 &&
        named(to) === 1;
      if (alone) renamed.set(from, to);
      else {
        touch(from, true);
        touch(to, true);
      }
    }
    const rewrites = schemaRewrites(
      catalog,
      kinds,
      { legacyAlterTable: pragmas.legacy === 1, foreignKeys: pragmas.keys === 1 },
      pending.flatMap((migration) => migration.sql),
    );
    if ('unread' in rewrites) return refuse(`the schema these migrations leave could not be read on a copy of it: ${rewrites.unread}`);
    for (const row of rewrites.rewritten) {
      const covered =
        reached.has(row.table.toLowerCase()) ||
        renamed.has(row.table.toLowerCase()) ||
        (row.type !== 'table' && changedObjects.has(`${row.type}:${row.name.toLowerCase()}`));
      if (!covered)
        return refuse(`these migrations change the uncaptured schema of ${row.name}; they need an explicit dependency-safe snapshot plan`);
    }
    touch('__drizzle_migrations', true);
    const tables: SnapshotTable[] = [];
    const witnesses: SnapshotWitnessTable[] = [];
    for (const [name, reach] of [...reached].sort(([a], [b]) => a.localeCompare(b))) {
      const row = existing.get(name);
      if (row === undefined) {
        tables.push({ name, definition: null, columns: [], rowid: null, savedRowid: null, data: false, added: [], sequence: null });
        continue;
      }
      if (row.definition === null || virtual.has(name)) return refuse(`migration snapshot cannot copy table ${name}`);
      const columns = yield* db.all<Column>(sql`select name, type, pk, hidden from pragma_table_xinfo(${row.name})`);
      const stored = columns.filter((column) => column.hidden === 0).map((column) => column.name);
      const lowered = new Set(columns.map((column) => column.name.toLowerCase()));
      const [shape] = yield* db.all<{ wr: number }>(sql`select wr from pragma_table_list where schema = 'main' and name = ${row.name}`);
      const rowid = shape?.wr === 1 ? null : ['rowid', '_rowid_', 'oid'].find((candidate) => !lowered.has(candidate));
      if (reach.data && rowid === undefined) return refuse(`table ${name} hides every rowid alias`);
      if (reach.data) {
        const keys =
          rowid === null
            ? columns
                .filter((column) => column.pk > 0)
                .sort((a, b) => a.pk - b.pk)
                .map((column) => column.name)
            : [rowid!];
        if (rowid === null) {
          const primary = yield* db.all<{ name: string }>(sql`select name from pragma_index_list(${row.name}) where origin = 'pk'`);
          for (const index of primary) {
            const descending = yield* db.all(sql`select name from pragma_index_xinfo(${index.name}) where "desc" <> 0 and "key" <> 0`);
            if (descending.length > 0) return refuse(`table ${name} has a descending primary key unsupported by the snapshot witness`);
          }
        }
        witnesses.push({ name: row.name, columns: stored, keys });
      }
      let savedRowid = '__snapshot_rowid';
      while (lowered.has(savedRowid)) savedRowid += '_';
      const sequence = existing.has('sqlite_sequence')
        ? ((yield* db.all<{ value: string }>(sql`select cast(seq as text) as value from sqlite_sequence where name = ${row.name}`))[0]
            ?.value ?? null)
        : null;
      tables.push({
        name: row.name,
        definition: row.definition,
        columns: stored,
        rowid: rowid ?? null,
        savedRowid: rowid === null || rowid === undefined ? null : savedRowid,
        data: reach.data,
        added: [...reach.added].filter((column) => !lowered.has(column)),
        sequence,
      });
      if (reach.data)
        for (const object of catalog) {
          if (object.table.toLowerCase() === name && object.definition !== null && (object.type === 'index' || object.type === 'trigger'))
            changeObject(object.name, object.type);
        }
    }
    for (const [from, to] of [...renamed].sort(([a], [b]) => a.localeCompare(b))) {
      const row = existing.get(from)!;
      if (row.definition === null) return refuse(`migration snapshot cannot rename back table ${from}`);
      const columns = yield* db.all<Column>(sql`select name, type, pk, hidden from pragma_table_xinfo(${row.name})`);
      tables.push({
        name: row.name,
        definition: row.definition,
        columns: columns.filter((column) => column.hidden === 0).map((column) => column.name),
        rowid: null,
        savedRowid: null,
        data: false,
        added: [],
        sequence: null,
        renamed: to,
      });
    }
    const capturedObjects: SnapshotObject[] = [...changedObjects]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, { name, type }]) => {
        const original = objects.get(key);
        return { type, name: original?.name ?? name, definition: original?.definition ?? null };
      });
    const [page] = yield* db.all<{ size: number }>(sql`select page_size as size from pragma_page_size`);
    return { tables, objects: capturedObjects, rebuilt: [...rebuilt].sort(), pageSize: page!.size, witnesses };
  },
  (effect, db, path, pending) =>
    effect.pipe(
      Effect.catchDefect((cause) =>
        Effect.fail(cause instanceof SnapshotFailed ? cause : new SnapshotFailed({ path, reason: String(cause) })),
      ),
      Effect.mapError((cause) => (cause instanceof SnapshotFailed ? cause : new SnapshotFailed({ path, reason: String(cause) }))),
    ),
);

const storedBytes = (db: EffectSQLiteBunDatabase, table: string) =>
  db.all<{ bytes: number }>(
    sql`select coalesce(sum(page.pgsize), 0) as bytes from (select ${table} as name union all select name from sqlite_master where type = 'index' and tbl_name = ${table}) as owned join dbstat('main') as page on page.name = owned.name`,
  );

export const snapshotReading = Effect.fn('Store.snapshotReading')(
  function* (db: EffectSQLiteBunDatabase, path: string, pending: readonly SnapshotMigration[]) {
    const plan = yield* snapshotPlan(db, path, pending);
    const witness = yield* snapshotWitness(db, plan.witnesses);
    let bytes = plan.pageSize * (plan.tables.length + plan.objects.length + 1);
    for (const table of plan.tables) {
      if (!table.data || table.definition === null) continue;
      const sizes = yield* Effect.result(storedBytes(db, table.name));
      if (sizes._tag === 'Success') bytes += Math.max(plan.pageSize, sizes.success[0]?.bytes ?? 0);
      else {
        yield* Effect.logDebug('the stored size of a table could not be read, so it is estimated from its rows', {
          table: table.name,
          reason: sizes.failure.message,
        });
        const payload = witness.bytes[table.name] ?? 0;
        const count = witness.rows[table.name] ?? 0;
        const indexCount = plan.objects.filter(
          (object) => object.type === 'index' && object.definition !== null && object.definition.includes(table.name),
        ).length;
        bytes += (payload + count * (9 * (table.columns.length + 4) + plan.pageSize) + plan.pageSize) * (indexCount + 1);
      }
    }
    const [epoch] = yield* db.all<{ changes: number; version: number; schema: number }>(
      sql`select total_changes() as changes, data_version as version, schema_version as schema from pragma_data_version, pragma_schema_version`,
    );
    const hash = createHash('sha256').update(JSON.stringify(plan)).update(witness.hash).digest('hex');
    return { plan, hash, rows: witness.rows, bytes, epoch: epoch! };
  },
  (effect, db, path, pending) =>
    effect.pipe(
      Effect.mapError((cause) => (cause instanceof SnapshotFailed ? cause : new SnapshotFailed({ path, reason: cause.message }))),
    ),
);

export const restoreSpace = Effect.fn('Store.restoreSpace')(
  function* (db: EffectSQLiteBunDatabase, path: string, tables: readonly SnapshotTable[]) {
    const [page] = yield* db.all<{ size: number }>(sql`select page_size as size from pragma_page_size`);
    const pageSize = page!.size;
    const standing = new Set(
      (yield* db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)).map((row) => row.name),
    );
    let bytes = pageSize * (tables.length + 1);
    for (const table of tables) {
      if (!standing.has(table.name) || (!table.data && table.definition !== null && table.added.length === 0)) continue;
      const measured = yield* Effect.result(storedBytes(db, table.name));
      if (measured._tag === 'Success') {
        bytes += measured.success[0]?.bytes ?? 0;
        continue;
      }
      yield* Effect.logDebug('the stored size of a table could not be read, so it is estimated from its rows', {
        table: table.name,
        reason: measured.failure.message,
      });
      const columns = yield* db.all<{ name: string }>(sql`select name from pragma_table_xinfo(${table.name}) where hidden = 0`);
      const fields = columns.map((column) => sql`coalesce(length(cast(${sql.identifier(column.name)} as blob)), 0)`);
      const [size] = yield* db.all<{ bytes: number; rows: number }>(
        sql`select coalesce(sum(${sql.join(fields, sql` + `)}), 0) as bytes, count(*) as rows from main.${sql.identifier(table.name)}`,
      );
      const [indexes] = yield* db.all<{ n: number }>(
        sql`select count(*) as n from sqlite_master where type = 'index' and tbl_name = ${table.name}`,
      );
      bytes += ((size?.bytes ?? 0) + (size?.rows ?? 0) * (pageSize + 9 * (columns.length + 4))) * ((indexes?.n ?? 0) + 1);
    }
    return bytes;
  },
  (effect, db, path, tables) => effect.pipe(Effect.mapError((cause) => new SnapshotFailed({ path, reason: cause.message }))),
);
