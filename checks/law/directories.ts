import type { Database } from 'bun:sqlite';
import { type Entry, entriesAt, git, present, type TreeRow as Row, treesRead } from './git';
import { databaseAt } from './store';

type Node = ReadonlyMap<string, Entry>;

const TREE = '040000';
const GITLINK = '160000';
const CHUNK = 400;
const KEPT_ROOTS = 256;
const SWEPT_ABOVE = 150_000;
const SWEPT_KEEPING = 64;
const OBJECT_ID = /^[0-9a-f]{40,64}$/;

const missing = (what: string): Error =>
  new Error(
    `the directory catalogue holds ${what}; build it with check_rules over "all" for a rule of the declaration or architecture inspections, then judge the change again`,
  );

const kindOf = (mode: string): string => (mode === TREE ? 'tree' : mode === GITLINK ? 'commit' : 'blob');

const marks = (count: number): string => Array.from({ length: count }, () => '?').join(',');

const nodes = new Map<string, Map<string, Node>>();

const held = (root: string): Map<string, Node> => {
  let one = nodes.get(root);
  if (one === undefined) {
    one = new Map();
    nodes.set(root, one);
  }
  return one;
};

const nodeOf = (rows: readonly Row[]): Node => new Map(rows.map(([name, mode, object]) => [name, { object, mode, kind: kindOf(mode) }]));

const loadNode = (root: string, tree: string): Node | undefined => {
  const memo = held(root);
  const known = memo.get(tree);
  if (known !== undefined) return known;
  const row = databaseAt(root).query<{ entries: string }, [string]>('SELECT entries FROM nodes WHERE tree = ?').get(tree);
  if (row === null) return undefined;
  const node = nodeOf(JSON.parse(row.entries) as Row[]);
  memo.set(tree, node);
  return node;
};

const presentNodes = (database: Database, ids: readonly string[]): Set<string> => {
  const found = new Set<string>();
  for (let at = 0; at < ids.length; at += CHUNK) {
    const part = ids.slice(at, at + CHUNK);
    for (const row of database
      .query<{ tree: string }, string[]>(`SELECT tree FROM nodes WHERE tree IN (${marks(part.length)})`)
      .all(...part))
      found.add(row.tree);
  }
  return found;
};

export type Directories = {
  readonly tree: string;
  readonly entry: (path: string) => Entry | undefined;
  readonly listed: (paths: readonly string[], recursive: boolean) => Map<string, Entry>;
};

const gitOrder = (left: readonly [string, Entry], right: readonly [string, Entry]): number =>
  Buffer.compare(
    Buffer.from(left[1].kind === 'tree' ? `${left[0]}/` : left[0]),
    Buffer.from(right[1].kind === 'tree' ? `${right[0]}/` : right[0]),
  );

const directoriesOf = (root: string, revision: string, tree: string): Directories => {
  const need = (id: string): Node => {
    const node = loadNode(root, id);
    if (node === undefined) throw missing(`no directory ${id} of ${revision}`);
    return node;
  };
  const directoryAt = (path: string): Node | undefined => {
    let node = need(tree);
    if (path === '') return node;
    for (const name of path.split('/')) {
      const next = node.get(name);
      if (next === undefined || next.kind !== 'tree') return undefined;
      node = need(next.object);
    }
    return node;
  };
  const entry = (path: string): Entry | undefined => {
    const at = path.lastIndexOf('/');
    return directoryAt(at < 0 ? '' : path.slice(0, at))?.get(path.slice(at + 1));
  };
  const children = (path: string, into: Map<string, Entry>): void => {
    for (const [name, one] of directoryAt(path) ?? []) into.set(path === '' ? name : `${path}/${name}`, one);
  };
  const descendants = (path: string, node: Node, into: Map<string, Entry>): void => {
    for (const [name, one] of node) {
      const full = path === '' ? name : `${path}/${name}`;
      if (one.kind === 'tree') descendants(full, need(one.object), into);
      else into.set(full, one);
    }
  };
  const listed = (paths: readonly string[], recursive: boolean): Map<string, Entry> => {
    const found = new Map<string, Entry>();
    if (paths.length === 0) {
      if (recursive) descendants('', need(tree), found);
      else children('', found);
      return found;
    }
    for (const path of paths) {
      if (path.endsWith('/')) {
        const name = path.slice(0, -1);
        const node = directoryAt(name);
        if (node === undefined) continue;
        if (recursive) descendants(name, node, found);
        else children(name, found);
        continue;
      }
      const one = entry(path);
      if (one === undefined) continue;
      if (recursive && one.kind === 'tree') descendants(path, need(one.object), found);
      else found.set(path, one);
    }
    return paths.length === 1 ? found : new Map([...found].sort(gitOrder));
  };
  return { tree, entry, listed };
};

const settled = new Map<string, Directories>();

export const directoriesAt = (root: string, revision: string): Directories | undefined => {
  if (!OBJECT_ID.test(revision)) return undefined;
  const key = `${root}\0${revision}`;
  const known = settled.get(key);
  if (known !== undefined) return known;
  const row = databaseAt(root).query<{ tree: string }, [string]>('SELECT tree FROM roots WHERE revision = ?').get(revision);
  if (row === null) return undefined;
  const directories = directoriesOf(root, revision, row.tree);
  settled.set(key, directories);
  return directories;
};

export const listedAt = (root: string, revision: string, paths: readonly string[], recursive: boolean): Map<string, Entry> =>
  directoriesAt(root, revision)?.listed(paths, recursive) ?? entriesAt(root, revision, paths, recursive);

const rootOf = (root: string, revision: string): string => {
  if (!OBJECT_ID.test(revision)) throw new Error(`not a git object id: ${revision}`);
  return git(root, ['rev-parse', '--verify', `${revision}^{tree}`])
    .toString()
    .trim();
};

const grouped = (listing: ReadonlyMap<string, Entry>): Map<string, Row[]> => {
  const groups = new Map<string, Row[]>();
  for (const [path, one] of listing) {
    const at = path.lastIndexOf('/');
    const directory = at < 0 ? '' : path.slice(0, at);
    const rows = groups.get(directory);
    const row: Row = [path.slice(at + 1), one.mode, one.object];
    if (rows === undefined) groups.set(directory, [row]);
    else rows.push(row);
  }
  return groups;
};

const record = (root: string, revision: string, tree: string, fresh: ReadonlyMap<string, readonly Row[]>): void => {
  const database = databaseAt(root);
  const insertNode = database.query('INSERT OR IGNORE INTO nodes (tree, entries) VALUES (?, ?)');
  const insertRoot = database.query('INSERT OR REPLACE INTO roots (revision, tree, at) VALUES (?, ?, ?)');
  database
    .transaction(() => {
      const needed = new Set([tree]);
      for (const rows of fresh.values()) for (const [, mode, object] of rows) if (mode === TREE) needed.add(object);
      const absent = [...needed].filter((id) => !fresh.has(id));
      const found = presentNodes(database, absent);
      const lacking = absent.find((id) => !found.has(id));
      if (lacking !== undefined) throw missing(`no directory ${lacking} below ${tree} of ${revision}`);
      for (const [id, rows] of fresh) insertNode.run(id, JSON.stringify(rows));
      insertRoot.run(revision, tree, Date.now());
      database.query('DELETE FROM roots WHERE revision IN (SELECT revision FROM roots ORDER BY at DESC LIMIT -1 OFFSET ?)').run(KEPT_ROOTS);
    })
    .immediate();
};

const swept = (root: string): void => {
  const database = databaseAt(root);
  const done = database
    .transaction((): boolean => {
      const total = database.query<{ count: number }, []>('SELECT count(*) AS count FROM nodes').get()!.count;
      if (total <= SWEPT_ABOVE) return false;
      const reachable = new Set<string>();
      const visit = (id: string): void => {
        if (reachable.has(id)) return;
        reachable.add(id);
        const row = database.query<{ entries: string }, [string]>('SELECT entries FROM nodes WHERE tree = ?').get(id);
        if (row === null) return;
        for (const [, mode, object] of JSON.parse(row.entries) as Row[]) if (mode === TREE) visit(object);
      };
      for (const row of database.query<{ tree: string }, [number]>('SELECT tree FROM roots ORDER BY at DESC LIMIT ?').all(SWEPT_KEEPING))
        visit(row.tree);
      database.exec('CREATE TEMP TABLE IF NOT EXISTS keeping (tree TEXT PRIMARY KEY) WITHOUT ROWID');
      database.exec('DELETE FROM keeping');
      const keep = database.query('INSERT OR IGNORE INTO keeping (tree) VALUES (?)');
      for (const id of reachable) keep.run(id);
      database.exec('DELETE FROM nodes WHERE tree NOT IN (SELECT tree FROM keeping)');
      database.query('DELETE FROM roots WHERE tree NOT IN (SELECT tree FROM keeping)').run();
      return true;
    })
    .immediate();
  if (!done) return;
  held(root).clear();
  settled.clear();
};

const catalogued = (root: string, revision: string, tree: string): boolean => {
  const database = databaseAt(root);
  return database
    .transaction((): boolean => {
      if (database.query('SELECT 1 FROM roots WHERE revision = ?').get(revision) !== null) return true;
      if (database.query('SELECT 1 FROM roots WHERE tree = ? LIMIT 1').get(tree) === null) return false;
      database.query('INSERT OR REPLACE INTO roots (revision, tree, at) VALUES (?, ?, ?)').run(revision, tree, Date.now());
      return true;
    })
    .immediate();
};

const populate = (root: string, revision: string): void => {
  const tree = rootOf(root, revision);
  if (catalogued(root, revision, tree)) return;
  const listing = entriesAt(root, revision, [], true, true);
  const groups = grouped(listing);
  const fresh = new Map<string, readonly Row[]>();
  fresh.set(tree, groups.get('') ?? []);
  for (const [path, one] of listing) if (one.kind === 'tree') fresh.set(one.object, groups.get(path) ?? []);
  record(root, revision, tree, fresh);
  swept(root);
};

const changedTrees = (root: string, base: string, revision: string): readonly string[] => {
  const output = git(root, ['diff-tree', '-r', '-t', '-z', '--raw', '--no-renames', '--no-abbrev', base, revision]).toString().split('\0');
  const changed: string[] = [];
  for (let at = 0; at + 1 < output.length; at += 2) {
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) /.exec(output[at]!);
    if (match !== null && match[2] === TREE) changed.push(match[4]!);
  }
  return changed;
};

const NEARBY = 6;
const GOOD_ENOUGH = 50;
const FAR = 5000;

const deriveFrom = (root: string, revision: string, tree: string, source: Directories): void => {
  const changed = [tree, ...changedTrees(root, source.tree, tree)];
  const stored = presentNodes(databaseAt(root), changed);
  record(
    root,
    revision,
    tree,
    treesRead(
      root,
      changed.filter((id) => !stored.has(id)),
    ),
  );
};

const nearest = (root: string, tree: string): Directories | undefined => {
  let best: { readonly source: Directories; readonly changes: number } | undefined;
  for (const row of databaseAt(root)
    .query<{ revision: string }, [number]>('SELECT revision FROM roots ORDER BY at DESC LIMIT ?')
    .all(NEARBY)) {
    const source = directoriesAt(root, row.revision);
    if (source === undefined || !present(root, [source.tree]).has(source.tree)) continue;
    const changes = changedTrees(root, source.tree, tree).length;
    if (best === undefined || changes < best.changes) best = { source, changes };
    if (changes < GOOD_ENOUGH) break;
  }
  return best === undefined || best.changes > FAR ? undefined : best.source;
};

const derive = (root: string, revision: string, base: string): void => {
  const tree = rootOf(root, revision);
  if (catalogued(root, revision, tree)) return;
  const baseTree = rootOf(root, base);
  if (!catalogued(root, base, baseTree)) {
    const near = nearest(root, baseTree);
    if (near === undefined) throw missing(`no revision near ${base} to derive ${revision} from`);
    deriveFrom(root, base, baseTree, near);
  }
  deriveFrom(root, revision, tree, directoriesAt(root, base)!);
};

const seeded = new Set<string>();

export const prepareDirectories = (root: string, revision: string, base: string | null): void => {
  const key = `${root}\0${revision}\0${base ?? ''}`;
  if (seeded.has(key)) return;
  if (base === null) populate(root, revision);
  else derive(root, revision, base);
  seeded.add(key);
};
