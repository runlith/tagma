import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import { databaseAt } from './store';

type Entry = readonly [key: string, value: unknown];
type Leaf = { readonly e: readonly Entry[] };
type Branch = { readonly c: readonly (readonly [digit: string, id: string, count: number])[] };
type Node = Leaf | Branch;
type Ref = { readonly id: string; readonly count: number };

const WIDTH = 12;
const DEPTH = 40;
const CHUNK = 400;
const KEPT_ROOTS = 256;
const KEPT_ACROSS = 1024;
const SWEPT_ABOVE = 200_000;
const MEMO_ABOVE = 60_000;

const missing = (what: string): Error =>
  new Error(
    `the keyed index holds ${what}; build it with check_rules over "all" for a rule of the declaration or architecture inspections, then judge the change again`,
  );

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

const marks = (count: number): string => Array.from({ length: count }, () => '?').join(',');

const memos = new Map<string, Map<string, Node>>();

const memoOf = (root: string): Map<string, Node> => {
  let one = memos.get(root);
  if (one === undefined) {
    one = new Map();
    memos.set(root, one);
  }
  if (one.size > MEMO_ABOVE) one.clear();
  return one;
};

const loaded = (root: string, id: string): Node | undefined => {
  const memo = memoOf(root);
  const known = memo.get(id);
  if (known !== undefined) return known;
  const row = databaseAt(root).query<{ body: string }, [string]>('SELECT body FROM map_nodes WHERE id = ?').get(id);
  if (row === null) return undefined;
  const node = JSON.parse(row.body) as Node;
  memo.set(id, node);
  return node;
};

const need = (root: string, id: string): Node => {
  const node = loaded(root, id);
  if (node === undefined) throw missing(`no node ${id}`);
  return node;
};

export const valueAt = (root: string, rootId: string, key: string): unknown => {
  const hash = sha1(key);
  let node = need(root, rootId);
  for (let depth = 0; depth <= DEPTH; depth += 1) {
    if ('e' in node) return node.e.find((one) => one[0] === key)?.[1];
    const child = node.c.find((one) => one[0] === hash[depth]);
    if (child === undefined) return undefined;
    node = need(root, child[1]);
  }
  throw missing(`a node deeper than ${DEPTH} below ${rootId}`);
};

export const entriesOf = (root: string, rootId: string): readonly Entry[] => {
  const found: Entry[] = [];
  const visit = (id: string): void => {
    const node = need(root, id);
    if ('e' in node) found.push(...node.e);
    else for (const [, child] of node.c) visit(child);
  };
  visit(rootId);
  return found.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
};

type Writer = { readonly root: string; readonly fresh: Map<string, string>; readonly nodes: Map<string, Node>; readonly refs: Set<string> };

const writerOf = (root: string): Writer => ({ root, fresh: new Map(), nodes: new Map(), refs: new Set() });

const read = (writer: Writer, id: string): Node => writer.nodes.get(id) ?? need(writer.root, id);

const made = (writer: Writer, node: Node): Ref => {
  const body = JSON.stringify(node);
  const id = sha1(body);
  writer.fresh.set(id, body);
  writer.nodes.set(id, node);
  if ('c' in node) {
    for (const [, child] of node.c) writer.refs.add(child);
    return { id, count: node.c.reduce((sum, one) => sum + one[2], 0) };
  }
  return { id, count: node.e.length };
};

const built = (writer: Writer, entries: readonly Entry[], depth: number): Ref => {
  if (entries.length <= WIDTH) return made(writer, { e: entries });
  if (depth >= DEPTH) throw new Error(`more than ${WIDTH} keys share a ${DEPTH}-digit hash`);
  const groups = new Map<string, Entry[]>();
  for (const one of entries) {
    const digit = sha1(one[0])[depth]!;
    const held = groups.get(digit);
    if (held === undefined) groups.set(digit, [one]);
    else held.push(one);
  }
  const children = [...groups]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([digit, list]) => {
      const ref = built(writer, list, depth + 1);
      return [digit, ref.id, ref.count] as const;
    });
  return made(writer, { c: children });
};

const gathered = (writer: Writer, id: string, into: Entry[]): void => {
  const node = read(writer, id);
  if ('e' in node) into.push(...node.e);
  else for (const [, child] of node.c) gathered(writer, child, into);
};

const changedAt = (
  writer: Writer,
  ref: Ref | undefined,
  depth: number,
  changes: readonly (readonly [string, unknown])[],
): Ref | undefined => {
  const node = ref === undefined ? undefined : read(writer, ref.id);
  if (node === undefined || 'e' in node) {
    const merged = new Map<string, unknown>((node?.e ?? []).map((one) => [one[0], one[1]]));
    for (const [key, value] of changes) {
      if (value === undefined) merged.delete(key);
      else merged.set(key, value);
    }
    if (merged.size === 0) return undefined;
    return built(
      writer,
      [...merged].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)),
      depth,
    );
  }
  const groups = new Map<string, (readonly [string, unknown])[]>();
  for (const one of changes) {
    const digit = sha1(one[0])[depth]!;
    const held = groups.get(digit);
    if (held === undefined) groups.set(digit, [one]);
    else held.push(one);
  }
  const children = new Map(node.c.map((one) => [one[0], { id: one[1], count: one[2] }]));
  for (const [digit, list] of groups) {
    const next = changedAt(writer, children.get(digit), depth + 1, list);
    if (next === undefined) children.delete(digit);
    else children.set(digit, next);
  }
  const total = [...children.values()].reduce((sum, one) => sum + one.count, 0);
  if (total === 0) return undefined;
  if (total <= WIDTH) {
    const entries: Entry[] = [];
    for (const one of children.values()) gathered(writer, one.id, entries);
    return made(writer, { e: entries.sort((left, right) => (left[0] < right[0] ? -1 : 1)) });
  }
  return made(writer, {
    c: [...children].sort((left, right) => (left[0] < right[0] ? -1 : 1)).map(([digit, one]) => [digit, one.id, one.count] as const),
  });
};

const presentNodes = (database: Database, ids: readonly string[]): Set<string> => {
  const found = new Set<string>();
  for (let at = 0; at < ids.length; at += CHUNK) {
    const part = ids.slice(at, at + CHUNK);
    for (const row of database.query<{ id: string }, string[]>(`SELECT id FROM map_nodes WHERE id IN (${marks(part.length)})`).all(...part))
      found.add(row.id);
  }
  return found;
};

const published = (root: string, family: string, revision: string, id: string, writer: Writer): void => {
  const database = databaseAt(root);
  const reused = [...new Set([id, ...writer.refs])].filter((one) => !writer.fresh.has(one));
  database
    .transaction(() => {
      const found = presentNodes(database, reused);
      const lacking = reused.find((one) => !found.has(one));
      if (lacking !== undefined) throw missing(`no node ${lacking} below ${id} of ${family}/${revision}`);
      const insert = database.query('INSERT OR IGNORE INTO map_nodes (id, body) VALUES (?, ?)');
      for (const [node, body] of writer.fresh) insert.run(node, body);
      database
        .query('INSERT OR REPLACE INTO map_roots (family, revision, root, at) VALUES (?, ?, ?, ?)')
        .run(family, revision, id, Date.now());
      database
        .query(
          'DELETE FROM map_roots WHERE family = ? AND revision IN (SELECT revision FROM map_roots WHERE family = ? ORDER BY at DESC LIMIT -1 OFFSET ?)',
        )
        .run(family, family, KEPT_ROOTS);
    })
    .immediate();
};

export const rootAt = (root: string, family: string, revision: string): string | undefined =>
  databaseAt(root)
    .query<{ root: string }, [string, string]>('SELECT root FROM map_roots WHERE family = ? AND revision = ?')
    .get(family, revision)?.root;

export const recentRoots = (root: string, family: string, limit: number): readonly { readonly revision: string; readonly id: string }[] =>
  databaseAt(root)
    .query<{ revision: string; root: string }, [string, number]>(
      'SELECT revision, root FROM map_roots WHERE family = ? ORDER BY at DESC LIMIT ?',
    )
    .all(family, limit)
    .map((one) => ({ revision: one.revision, id: one.root }));

export const derivedMap = (root: string, family: string, revision: string, from: string, changes: ReadonlyMap<string, unknown>): string => {
  const writer = writerOf(root);
  const ordered = [...changes].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const base = need(root, from);
  const ref: Ref = { id: from, count: 'e' in base ? base.e.length : base.c.reduce((sum, one) => sum + one[2], 0) };
  const next = changedAt(writer, ref, 0, ordered) ?? made(writer, { e: [] });
  published(root, family, revision, next.id, writer);
  return next.id;
};

const swept = (root: string): void => {
  const database = databaseAt(root);
  const done = database
    .transaction((): boolean => {
      database
        .query(
          'DELETE FROM map_roots WHERE (family, revision) IN (SELECT family, revision FROM map_roots ORDER BY at DESC LIMIT -1 OFFSET ?)',
        )
        .run(KEPT_ACROSS);
      const total = database.query<{ count: number }, []>('SELECT count(*) AS count FROM map_nodes').get()!.count;
      if (total <= SWEPT_ABOVE) return false;
      const reachable = new Set<string>();
      const visit = (id: string): void => {
        if (reachable.has(id)) return;
        reachable.add(id);
        const row = database.query<{ body: string }, [string]>('SELECT body FROM map_nodes WHERE id = ?').get(id);
        if (row === null) return;
        const node = JSON.parse(row.body) as Node;
        if ('c' in node) for (const [, child] of node.c) visit(child);
      };
      for (const row of database.query<{ root: string }, []>('SELECT DISTINCT root FROM map_roots').all()) visit(row.root);
      database.exec('CREATE TEMP TABLE IF NOT EXISTS map_keeping (id TEXT PRIMARY KEY) WITHOUT ROWID');
      database.exec('DELETE FROM map_keeping');
      const keep = database.query('INSERT OR IGNORE INTO map_keeping (id) VALUES (?)');
      for (const id of reachable) keep.run(id);
      database.exec('DELETE FROM map_nodes WHERE id NOT IN (SELECT id FROM map_keeping)');
      return true;
    })
    .immediate();
  if (done) memoOf(root).clear();
};

export const seededMap = (root: string, family: string, revision: string, entries: Iterable<Entry>): string => {
  const writer = writerOf(root);
  const ordered = [...entries].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  const ref = built(writer, ordered, 0);
  published(root, family, revision, ref.id, writer);
  swept(root);
  return ref.id;
};
