import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import {
  PROJECTION_BYTES,
  PROJECTION_CLOCK,
  type RowChange,
  type RowCommit,
  type RowProjection,
  type RowSelection,
  type SelectedRow,
  type SelectionWork,
  type ProjectionWrite,
} from './channel.js';

const identifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const AUTH = '__row_authorized';
const STATE = '__row_capture_state';
const ROWS = '__row_capture';
const DIRTY = '__row_selection_dirty';

export type RowCapture = {
  readonly begin: (budget?: number) => void;
  readonly authorize: (projections: ProjectionWrite) => void;
  readonly validate: () => void;
  readonly seal: () => RowCommit | undefined;
  readonly bytes: () => number;
  readonly work: () => readonly SelectionWork[];
};

export const makeRowCapture = (
  db: Database,
  projections: readonly RowProjection[],
  selections: readonly RowSelection[] = [],
  reset = false,
): RowCapture => {
  const incarnation = randomUUID();
  let work: SelectionWork[] = [];
  const ids = new Set<string>();
  const schema = db.query('PRAGMA main.schema_version');
  const triggers = db.query("SELECT count(*) FROM sqlite_temp_master WHERE type = 'trigger' AND name GLOB '__row_*'");
  db.run('PRAGMA recursive_triggers = ON');
  db.run(`CREATE TABLE IF NOT EXISTS ${PROJECTION_CLOCK} (id TEXT PRIMARY KEY, version TEXT NOT NULL, cursor INTEGER NOT NULL)`);
  db.run(`INSERT OR IGNORE INTO ${PROJECTION_CLOCK} VALUES ('', '', 0)`);
  if (reset) {
    for (const [name] of db.query("SELECT name FROM sqlite_temp_master WHERE type = 'trigger' AND name GLOB '__row_*'").values())
      db.run(`DROP TRIGGER ${identifier(String(name))}`);
    for (const name of [AUTH, STATE, ROWS, DIRTY]) db.run(`DROP TABLE IF EXISTS temp.${identifier(name)}`);
  }
  db.run(`CREATE TEMP TABLE ${AUTH} (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE ${STATE} (id INTEGER PRIMARY KEY, touched INTEGER, bytes INTEGER, gap INTEGER, budget INTEGER);
    INSERT INTO ${STATE} VALUES (1, ${reset ? 1 : 0}, 0, ${reset ? 1 : 0}, ${PROJECTION_BYTES});
    CREATE TEMP TABLE ${ROWS} (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);
    CREATE TEMP TABLE ${DIRTY} (selection TEXT, key TEXT, PRIMARY KEY(selection, key));`);
  const selectedIds = new Set<string>();
  for (const selection of selections) {
    if (selectedIds.has(selection.id) || selection.columns.length === 0) throw new Error(`Invalid row selection: ${selection.id}`);
    selectedIds.add(selection.id);
    for (const source of selection.sources) {
      const projection = projections.find((projection) => projection.id === source.projection);
      if (projection === undefined || source.columns.some((column) => !projection.columns.includes(column)))
        throw new Error(`${selection.id}: its source is not a declared projected column`);
    }
  }

  for (const [index, projection] of projections.entries()) {
    if (ids.has(projection.id) || projection.keys.length === 0) throw new Error(`Invalid row projection: ${projection.id}`);
    ids.add(projection.id);
    const columns = db.query(`PRAGMA main.table_xinfo(${identifier(projection.table)})`).all() as { name: string; type: string }[];
    const selected = [
      ...new Set([...projection.keys, ...projection.columns, ...(projection.address === undefined ? [] : [projection.address])]),
    ];
    if (reset && columns.length === 0) continue;
    if (!reset)
      for (const name of selected) {
        const column = columns.find((column) => column.name === name);
        if (column === undefined || /blob/i.test(column.type))
          throw new Error(`${projection.id}: unsupported or missing projected column ${name}`);
      }
    const checked = reset ? selected.filter((name) => columns.some((column) => column.name === name)) : selected;
    if ((projection.context ?? []).some((column) => !projection.columns.includes(column)))
      throw new Error(`${projection.id}: row context must name projected columns`);
    const signature = JSON.stringify(projection);
    db.query(
      `INSERT INTO ${PROJECTION_CLOCK} VALUES (?, ?, (SELECT cursor FROM ${PROJECTION_CLOCK} WHERE id = '')) ON CONFLICT(id) DO UPDATE SET version = excluded.version, cursor = excluded.cursor`,
    ).run(projection.id, signature);
    const column = (side: 'OLD' | 'NEW', name: string) => `${side}.${identifier(name)}`;
    const key = (side: 'OLD' | 'NEW') => `json_array(${projection.keys.map((name) => column(side, name)).join(',')})`;
    const address = (side: 'OLD' | 'NEW') => (projection.address === undefined ? 'NULL' : column(side, projection.address));
    const changed = (name: string) => `${column('OLD', name)} IS NOT ${column('NEW', name)}`;
    const keyChanged = projection.keys.map(changed).join(' OR ');
    const context = projection.context ?? [];
    const patch = (insert: boolean) => `(
      SELECT json_group_object(name, value) FROM (
        ${projection.columns.map((name) => `SELECT ${literal(name)} AS name, ${column('NEW', name)} AS value${insert || context.includes(name) ? '' : ` WHERE ${changed(name)}`}`).join(' UNION ALL ')}
      )
    )`;
    const size = (value: string) => `(64 + 6 * coalesce(length(CAST(${value} AS BLOB)), 0))`;
    const admitted = (side: 'OLD' | 'NEW') => `
        SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ${AUTH} WHERE id = ${literal(projection.id)})
          THEN RAISE(ABORT, ${literal(`undeclared row projection: ${projection.id}`)}) END;
        SELECT CASE WHEN ${checked.map((name) => `typeof(${column(side, name)}) = 'blob'`).join(' OR ') || '0'}
          THEN RAISE(ABORT, ${literal(`unsupported row value: ${projection.id}`)}) END;`;
    const capture = (kind: RowChange['kind'], side: 'OLD' | 'NEW', values: string, cost: string) => {
      const before = kind === 'insert' ? 'NULL' : address('OLD');
      const body = `json_object('projection', ${literal(projection.id)}, 'kind', ${literal(kind)}, 'key', json(${key(side)}),
        'address', ${address(side)}, 'before', ${before}, 'values', json(${values}))`;
      return `${admitted(side)}
        UPDATE ${STATE} SET touched = 1, gap = bytes + (${cost}) > budget, bytes = min(budget, bytes + (${cost})) WHERE gap = 0;
        DELETE FROM ${ROWS} WHERE (SELECT gap FROM ${STATE}) = 1;
        INSERT INTO ${ROWS}(body) SELECT ${body} WHERE (SELECT gap FROM ${STATE}) = 0;`;
    };
    const identitySize = (side: 'OLD' | 'NEW') =>
      [
        String(256 + 6 * Buffer.byteLength(projection.id)),
        ...projection.keys.map((name) => size(column(side, name))),
        size(address(side)),
      ].join(' + ');
    const valuesSize = (insert: boolean) =>
      projection.columns
        .map((name) => {
          const cost = `${64 + 6 * Buffer.byteLength(name)} + ${size(column('NEW', name))}`;
          return insert || context.includes(name) ? `(${cost})` : `(CASE WHEN ${changed(name)} THEN ${cost} ELSE 0 END)`;
        })
        .join(' + ') || '0';
    const removedValues = `json_object(${context.flatMap((name) => [literal(name), column('OLD', name)]).join(',')})`;
    const removedSize = `${identitySize('OLD')} + ${context.map((name) => `${64 + 6 * Buffer.byteLength(name)} + ${size(column('OLD', name))}`).join(' + ') || '0'}`;
    const trigger = (name: string, when: string, body: string, condition = '') =>
      db.run(
        `CREATE TEMP TRIGGER ${identifier(`__row_${index}_${name}`)} ${when} ON main.${identifier(projection.table)} ${condition} BEGIN ${body} END`,
      );
    if (reset) {
      for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const)
        trigger(`gate_${operation}`, `AFTER ${operation}`, admitted(operation === 'DELETE' ? 'OLD' : 'NEW'));
      continue;
    }
    const dirty = (side: 'OLD' | 'NEW', only?: string) =>
      selections
        .flatMap((selection) =>
          (only === undefined || selection.id === only) && selection.sources.some((source) => source.projection === projection.id)
            ? [selection]
            : [],
        )
        .map((selection) => {
          const value = `json_array(${address(side)})`;
          const eligible = selection.sources.find((source) => source.projection === projection.id)!.when?.replaceAll('$row', side) ?? '1';
          const cost = `${128 + 6 * Buffer.byteLength(selection.id)} + ${size(address(side))}`;
          return `UPDATE ${STATE} SET touched = 1, gap = bytes + (${cost}) > budget, bytes = min(budget, bytes + (${cost}))
        WHERE gap = 0 AND (${eligible}) AND NOT EXISTS (SELECT 1 FROM ${DIRTY} WHERE selection = ${literal(selection.id)} AND key = ${value});
        DELETE FROM ${ROWS} WHERE (SELECT gap FROM ${STATE}) = 1;
        DELETE FROM ${DIRTY} WHERE (SELECT gap FROM ${STATE}) = 1;
        INSERT INTO ${DIRTY} SELECT ${literal(selection.id)}, ${value} WHERE (SELECT gap FROM ${STATE}) = 0 AND (${eligible})
          AND NOT EXISTS (SELECT 1 FROM ${DIRTY} WHERE selection = ${literal(selection.id)} AND key = ${value});`;
        })
        .join('\n');
    trigger('insert', 'AFTER INSERT', capture('insert', 'NEW', patch(true), `${identitySize('NEW')} + ${valuesSize(true)}`) + dirty('NEW'));
    trigger('delete', 'AFTER DELETE', capture('delete', 'OLD', removedValues, removedSize) + dirty('OLD'));
    trigger('replace_old', 'AFTER UPDATE', capture('delete', 'OLD', removedValues, removedSize) + dirty('OLD'), `WHEN ${keyChanged}`);
    trigger(
      'replace_new',
      'AFTER UPDATE',
      capture('insert', 'NEW', patch(true), `${identitySize('NEW')} + ${valuesSize(true)}`) + dirty('NEW'),
      `WHEN ${keyChanged}`,
    );
    trigger(
      'update',
      'AFTER UPDATE',
      capture('update', 'NEW', patch(false), `${identitySize('NEW')} + ${size(address('OLD'))} + ${valuesSize(false)}`),
      `WHEN NOT (${keyChanged}) AND (${[...projection.columns, ...(projection.address === undefined ? [] : [projection.address])].map(changed).join(' OR ') || '0'})`,
    );
    for (const [selectedIndex, selection] of selections.entries()) {
      const source = selection.sources.find((source) => source.projection === projection.id);
      if (source !== undefined)
        trigger(
          `select_${selectedIndex}`,
          'AFTER UPDATE',
          dirty('OLD', selection.id) + dirty('NEW', selection.id),
          `WHEN ${[...new Set([...source.columns, ...(projection.address === undefined ? [] : [projection.address])])].map(changed).join(' OR ') || '0'}`,
        );
    }
  }
  let installed = schema.values()[0]![0];
  const shapeOf = () =>
    JSON.stringify([
      triggers.values()[0]![0],
      ...projections.map((projection) => db.query(`PRAGMA main.table_xinfo(${identifier(projection.table)})`).values()),
    ]);
  const shape = shapeOf();
  const authorized = db.query(`SELECT id FROM ${AUTH}`);
  const clearing = db.query(`DELETE FROM ${AUTH}`);
  const authorizing = db.query(`INSERT INTO ${AUTH} VALUES (?)`);
  const resetting = db.query(`UPDATE ${STATE} SET touched = 0, bytes = 0, gap = 0, budget = ?`);
  const state = db.query(`SELECT touched, bytes, gap, budget FROM ${STATE}`);
  const rows = db.query(`SELECT body FROM ${ROWS} ORDER BY seq`);
  const dirty = db.query(`SELECT selection, key FROM ${DIRTY} ORDER BY selection, key`);
  const selectors = new Map(
    (reset ? [] : selections).map((selection) => {
      const cost = selection.columns
        .map((name) => `${128 + 6 * Buffer.byteLength(name)} + 6 * coalesce(length(CAST(selected.${identifier(name)} AS BLOB)), 0)`)
        .join(' + ');
      const value = `json_object(${selection.columns.flatMap((name) => [literal(name), `selected.${identifier(name)}`]).join(',')})`;
      return [
        selection.id,
        db.query(`SELECT CASE WHEN (${cost}) <= ?2 THEN ${value} END AS body, (${cost}) AS bytes FROM (${selection.sql}) selected LIMIT 2`),
      ] as const;
    }),
  );
  const advancing = db.query(`UPDATE ${PROJECTION_CLOCK} SET cursor = cursor + 1 RETURNING id, cursor`);
  const validate = () => {
    const now = schema.values()[0]![0];
    if (now === installed) return;
    if (shapeOf() !== shape) throw new Error('The projected schema changed after row capture was installed.');
    installed = now;
  };
  return {
    authorize: (projections) => {
      const wanted = new Set(projections === 'effects' ? ids : projections);
      for (const id of wanted) if (!ids.has(id)) throw new Error(`Unknown row projection: ${id}`);
      const held = authorized.values();
      if (held.length === wanted.size && held.every((row) => wanted.has(String(row[0])))) return;
      clearing.run();
      for (const id of wanted) authorizing.run(id);
    },
    begin: (budget = PROJECTION_BYTES) => {
      work = [];
      db.run(`DELETE FROM ${ROWS}; DELETE FROM ${DIRTY}`);
      resetting.run(budget);
    },
    validate,
    bytes: () => Number(state.values()[0]![1]),
    work: () => work,
    seal: () => {
      work = [];
      validate();
      const [held] = state.values();
      if (held![0] === 0) return undefined;
      const selected: SelectedRow[] = [];
      let gap = held![2] !== 0;
      let remaining = Number(held![3]) - Number(held![1]);
      if (!gap)
        for (const [id, key] of dirty.values()) {
          const logical = (JSON.parse(String(key)) as [string | number | null])[0];
          const started = performance.now();
          const result = selectors.get(String(id))!.values(logical, remaining);
          work.push({ selection: String(id), execMs: performance.now() - started, rows: result.length });
          if (result.length > 1) throw new Error(`${String(id)} answered more than one selected row.`);
          if (result.length === 1 && result[0]![0] === null) {
            gap = true;
            break;
          }
          remaining -= Number(result[0]?.[1] ?? 0);
          selected.push({ selection: String(id), key: logical, values: result.length === 0 ? null : JSON.parse(String(result[0]![0])) });
        }
      db.query(`UPDATE ${STATE} SET bytes = ?, gap = ?`).run(gap ? Number(held![3]) : Number(held![3]) - remaining, gap ? 1 : 0);
      const advanced = advancing.values();
      const cursor = Number(advanced.find((row) => row[0] === '')![1]);
      if (gap) return { _tag: 'Gap', incarnation, cursor, bytes: 0 };
      const changes = rows.values().map((row) => JSON.parse(String(row[0])) as RowChange);
      return { _tag: 'Complete', incarnation, cursor, bytes: Number(held![3]) - remaining, changes, selected };
    },
  };
};
