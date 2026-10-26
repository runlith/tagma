import { sql } from 'drizzle-orm';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import { Context, Effect } from 'effect';
import { LateStatementRefused, UnitLife } from './life.js';
import type { StoreFailure, StoreIdentity } from '../contract/service/store.js';
import type { DurabilityClass } from '../contract/service/durability.js';
import { UnitWriteRefused, type WriteSet, WriteSetMode } from '../contract/service/writes.js';
import { schemaStatement, statementTarget, triggerShape, type ConflictPolicy, type StatementWrite, type Verb } from './statementTarget.js';
import { columnShape, type ColumnShape } from './columnShape.js';

export const UnitWrites = Context.Reference<ReadonlyMap<StoreIdentity, WriteSet | null>>('tagma/platform/UnitWrites', {
  defaultValue: () => new Map(),
});

export const UnitDurability = Context.Reference<ReadonlyMap<StoreIdentity, DurabilityClass>>('tagma/platform/UnitDurability', {
  defaultValue: () => new Map(),
});

const reported = new WeakMap<StoreIdentity, Set<string>>();

export const breach = (identity: StoreIdentity, refused: UnitWriteRefused): Effect.Effect<void> =>
  Effect.flatMap(WriteSetMode, (mode) => {
    if (mode === 'refuse') return Effect.die(refused);
    const key = `${refused.operation}\u0000${refused.table}\u0000${refused.reason}`;
    const seen = reported.get(identity) ?? new Set<string>();
    return Effect.andThen(
      Effect.annotateCurrentSpan('db.unit.breach', refused.reason),
      seen.has(key)
        ? Effect.void
        : Effect.sync(() => {
            seen.add(key);
            reported.set(identity, seen);
            console.warn(`[tagma] ${refused.message}; reported, not refused, while write sets are being declared`);
          }),
    );
  });

type Consequence = { readonly on: Verb; readonly of: ReadonlySet<string> | null } & (
  | { readonly write: StatementWrite }
  | { readonly statement: string }
);
type TableWrites = { readonly shape: ColumnShape; readonly rowid: string | null; readonly derived: ReadonlyMap<string, readonly string[]> };
export type Consequences = {
  readonly edges: ReadonlyMap<string, readonly Consequence[]>;
  readonly tables: ReadonlyMap<string, TableWrites>;
};
export type WriteReach =
  | { readonly kind: 'written'; readonly writes: readonly StatementWrite[] }
  | { readonly kind: 'unresolved'; readonly statement: string };

const consequences = new WeakMap<StoreIdentity, Consequences>();

const ACTIONS: Record<string, Verb | undefined> = { cascade: undefined, 'set null': 'update', 'set default': 'update' };

type TriggerRow = { readonly on: string; readonly sql: string };
type KeyRow = { readonly child: string; readonly parent: string; readonly on_update: string; readonly on_delete: string };

export const readWriteConsequences = Effect.fnUntraced(function* (db: EffectSQLiteBunDatabase) {
  const [setting] = yield* db.all<{ enabled: number }>(sql`select foreign_keys as enabled from pragma_foreign_keys`);
  const triggers = yield* db.all<TriggerRow>(
    sql`select tbl_name as "on", sql from sqlite_master where type = 'trigger' and sql is not null`,
  );
  const keys =
    setting?.enabled === 1
      ? yield* db.all<KeyRow>(
          sql`select m.name as child, f."table" as parent, f.on_update, f.on_delete from sqlite_master m join pragma_foreign_key_list(m.name) f where m.type = 'table'`,
        )
      : [];
  const definitions = yield* db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'table' and sql is not null`,
  );
  const aliases = new Map(
    (yield* db.all<{ table: string; column: string }>(sql`
      select m.name as "table", p.name as "column" from sqlite_master m
      join pragma_table_xinfo(m.name) p join pragma_table_list t on t.name = m.name and t.schema = 'main'
      where m.type = 'table' and t.type = 'table' and t.wr = 0 and p.pk = 1 and upper(p.type) = 'INTEGER'
        and not exists (select 1 from pragma_index_list(m.name) where origin = 'pk')`)).map((row) => [
      row.table.toLowerCase(),
      row.column.toLowerCase(),
    ]),
  );
  const tables = new Map<string, TableWrites>();
  for (const table of definitions) {
    const shape = columnShape(table.sql);
    const derived = new Map<string, string[]>();
    for (const [column, sources] of shape.generated)
      for (const source of sources) {
        const targets = derived.get(source) ?? [];
        targets.push(column);
        derived.set(source, targets);
      }
    tables.set(table.name.toLowerCase(), { shape, rowid: aliases.get(table.name.toLowerCase()) ?? null, derived });
  }
  return { edges: consequencesOf(triggers, keys).edges, tables };
});

export const readConsequences = (identity: StoreIdentity, db: EffectSQLiteBunDatabase): Effect.Effect<void, StoreFailure> =>
  Effect.map(readWriteConsequences(db), (edges) => void consequences.set(identity, edges));

export const recordConsequences = (identity: StoreIdentity, triggers: readonly TriggerRow[], keys: readonly KeyRow[]): void => {
  consequences.set(identity, consequencesOf(triggers, keys));
};

const consequencesOf = (triggers: readonly TriggerRow[], keys: readonly KeyRow[]): Consequences => {
  const edges = new Map<string, Consequence[]>();
  const add = (from: string, consequence: Consequence) => {
    const name = from.toLowerCase();
    const listed = edges.get(name) ?? [];
    listed.push(consequence);
    edges.set(name, listed);
  };
  for (const trigger of triggers) {
    const shape = triggerShape(trigger.sql);
    for (const statement of shape.body) {
      const target = statementTarget(statement);
      if (target.kind === 'other') continue;
      for (const on of shape.on === null ? (['insert', 'update', 'delete'] as const) : [shape.on]) {
        add(trigger.on, target.kind === 'write' ? { on, of: shape.of, write: target } : { on, of: shape.of, statement });
      }
    }
  }
  for (const key of keys) {
    for (const [on, action] of [
      ['delete', key.on_delete],
      ['update', key.on_update],
    ] as const) {
      const lowered = action.toLowerCase();
      if (lowered in ACTIONS)
        add(key.parent, {
          on,
          of: null,
          write: { kind: 'write', verb: ACTIONS[lowered] ?? on, table: key.child.toLowerCase(), columns: 'all', replacing: false },
        });
    }
  }
  return { edges, tables: new Map() };
};

const physicalWrite = (table: TableWrites | undefined, write: StatementWrite, conflict: ConflictPolicy | undefined): StatementWrite => {
  const replacing =
    conflict === 'replace' ||
    (conflict === undefined &&
      (write.replacing ||
        table?.shape.replacing.some(
          (key) =>
            write.verb === 'insert' ||
            write.columns === 'all' ||
            [...key].some((column) => write.columns !== 'all' && write.columns.has(column)),
        )) === true);
  if (table === undefined || write.columns === 'all') return { ...write, replacing };
  const columns = new Set(write.columns);
  const aliases = ['rowid', '_rowid_', 'oid'].filter((name) => !table.shape.columns.has(name));
  if (table.rowid !== null && (columns.has(table.rowid) || aliases.some((name) => columns.has(name)))) {
    columns.add(table.rowid);
    for (const alias of aliases) columns.add(alias);
  }
  const pending = [...columns];
  for (let at = 0; at < pending.length; at += 1)
    for (const column of table.derived.get(pending[at]!) ?? []) {
      if (columns.has(column)) continue;
      columns.add(column);
      pending.push(column);
    }
  return { ...write, replacing, columns };
};

export const reachedWrites = (effects: Consequences, target: StatementWrite): WriteReach => {
  const found: StatementWrite[] = [];
  let unresolved: string | undefined;
  const seen = new Set<string>();
  const walk = (source: StatementWrite, inherited?: ConflictPolicy): boolean => {
    const conflict = inherited ?? source.conflict;
    const write = physicalWrite(effects.tables.get(source.table), source, conflict);
    const id = `${write.verb}:${write.table}:${write.columns === 'all' ? '*' : [...write.columns].sort().join(',')}:${source.columns === 'all' ? '*' : [...source.columns].sort().join(',')}:${write.replacing}:${write.updating}:${conflict}`;
    if (seen.has(id)) return true;
    seen.add(id);
    found.push(write);
    const verbs = new Set<Verb>([
      write.verb,
      ...(write.replacing ? (['delete'] as const) : []),
      ...(write.updating ? (['update'] as const) : []),
    ]);
    for (const next of effects.edges.get(write.table) ?? []) {
      if (!verbs.has(next.on)) continue;
      if (
        next.on === 'update' &&
        next.of !== null &&
        source.columns !== 'all' &&
        ![...source.columns].some((column) => next.of!.has(column))
      )
        continue;
      if ('statement' in next) {
        unresolved = next.statement;
        return false;
      }
      if (!walk(next.write, conflict)) return false;
    }
    return true;
  };
  walk(target);
  return unresolved === undefined ? { kind: 'written', writes: found } : { kind: 'unresolved', statement: unresolved };
};

const closures = new WeakMap<Consequences, Map<string, ReadonlySet<string> | null>>();

const closureOf = (effects: Consequences | undefined, table: string): ReadonlySet<string> | null => {
  const reached = new Set([table]);
  const pending = [table];
  for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
    for (const next of effects?.edges.get(at) ?? []) {
      if ('statement' in next) return null;
      if (reached.has(next.write.table)) continue;
      reached.add(next.write.table);
      pending.push(next.write.table);
    }
  }
  return reached;
};

export const movedTables = (identity: StoreIdentity, set: WriteSet | null): ReadonlySet<string> | null => {
  if (set === null) return null;
  const effects = consequences.get(identity);
  const known = effects === undefined ? new Map<string, ReadonlySet<string> | null>() : (closures.get(effects) ?? new Map());
  if (effects !== undefined) closures.set(effects, known);
  const moved = new Set<string>();
  for (const table of set.reach.keys()) {
    const reached = known.has(table) ? (known.get(table) ?? null) : closureOf(effects, table);
    known.set(table, reached);
    if (reached === null) return null;
    for (const one of reached) moved.add(one);
  }
  return moved;
};

export const checkStatement =
  (identity: StoreIdentity) =>
  (statement: string): Effect.Effect<void> =>
    Effect.flatMap(UnitLife, (life) =>
      life !== null && !life.open && life.identity === identity
        ? Effect.die(new LateStatementRefused({ store: identity.path, operation: life.operation }))
        : checkWrites(identity, statement),
    );

const checkWrites = (identity: StoreIdentity, statement: string): Effect.Effect<void> =>
  Effect.flatMap(UnitWrites, (open) => {
    const set = open.get(identity);
    if (set === undefined || set === null) return Effect.void;
    const target = statementTarget(statement);
    if (target.kind === 'other') return Effect.void;
    const refused = (table: string | null, reason: UnitWriteRefused['reason']) =>
      breach(identity, new UnitWriteRefused({ store: identity.path, operation: set.operation, table, reason }));
    if (target.kind === 'unresolved') {
      const schema = schemaStatement(statement);
      if (schema.kind === 'drop-table' && !schema.temporary) {
        if (set.reach.get(schema.table) !== 'all') return refused(schema.table, 'outside-write-set');
        const reach = reachedWrites(consequences.get(identity) ?? { edges: new Map(), tables: new Map() }, {
          kind: 'write',
          verb: 'delete',
          table: schema.table,
          columns: 'all',
          replacing: false,
        });
        return reach.kind === 'unresolved' ? refused(null, 'unresolved-target') : Effect.void;
      }
      return refused(null, 'unresolved-target');
    }
    const allowed = set.reach.get(target.table);
    if (allowed === undefined) return refused(target.table, 'outside-write-set');
    const columns = target.columns === 'all' ? null : [...target.columns];
    if (allowed !== 'all' && (columns === null || !columns.every((column) => allowed.has(column))))
      return refused(target.table, 'outside-write-set');
    const unread = reachedWrites(consequences.get(identity) ?? { edges: new Map(), tables: new Map() }, target).kind === 'unresolved';
    return unread ? refused(null, 'unresolved-target') : Effect.void;
  });
