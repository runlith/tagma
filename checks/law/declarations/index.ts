import { createRequire } from 'node:module';
import { posix } from 'node:path';
import type { Database } from 'bun:sqlite';
import { blobTexts, type Entry, entriesAt, git } from '../git';
import { type Packed, pack, unpack } from './compact';
import { isManifest, isSource, type Package, packageOf } from './corpus';
import { databaseAt } from './database';
import type { Facts } from './facts';
import { revisionAt, saveRevision } from './memo';
import { type Alias, keyStems, resolverOf } from './resolve';

const load = createRequire(import.meta.url);

let reader: typeof import('./read') | undefined;

const factsOf = (path: string, text: string): Facts => (reader ??= load('./read.ts') as typeof import('./read')).factsOf(path, text);

export type Change = { readonly path: string; readonly before: string | null; readonly after: string | null };

const GLOB = '\0glob';

const CHUNK = 400;

const classOf = (path: string): string => (path.endsWith('.svelte') ? 's' : /\.[jt]sx$/.test(path) ? 'x' : 't');

const stemOf = (name: string): string => name.replace(/\.[cm]?[jt]sx?$/, '');

const stemsOfFile = (path: string): readonly string[] => {
  const parts = path.split('/');
  const name = stemOf(parts[parts.length - 1]!);
  return [...new Set([name, ...(name === 'index' && parts.length > 1 ? [parts[parts.length - 2]!] : []), '.'])];
};

const linksOfFacts = (facts: Facts): readonly (readonly [stem: string, spec: string])[] => {
  const links = new Map<string, readonly [string, string]>();
  const add = (specifier: string): void => {
    const stem = stemOf(specifier.slice(specifier.lastIndexOf('/') + 1)) || '.';
    links.set(`${stem}\0${specifier}`, [stem, specifier]);
  };
  for (const one of facts.imports) add(one.specifier);
  for (const one of facts.forwards) add(one.specifier);
  for (const one of facts.loads) {
    if (one.pattern) links.set(GLOB, [GLOB, '']);
    else add(one.specifier);
  }
  return [...links.values()];
};

const regular = (entry: Entry): boolean => entry.kind === 'blob' && (entry.mode === '100644' || entry.mode === '100755');

const indexable = (path: string): boolean => isSource(path) || isManifest(path);

const chunks = <T>(values: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let at = 0; at < values.length; at += CHUNK) out.push(values.slice(at, at + CHUNK));
  return out;
};

const marks = (count: number): string => Array.from({ length: count }, () => '?').join(',');

const heldFacts = (database: Database, blobs: readonly string[]): Set<string> => {
  const found = new Set<string>();
  for (const part of chunks(blobs))
    for (const row of database
      .query<{ blob: string; class: string }, string[]>(`SELECT blob, class FROM facts WHERE blob IN (${marks(part.length)})`)
      .all(...part))
      found.add(`${row.blob}\0${row.class}`);
  return found;
};

const heldManifests = (database: Database, blobs: readonly string[]): Set<string> => {
  const found = new Set<string>();
  for (const part of chunks(blobs))
    for (const row of database
      .query<{ blob: string }, string[]>(`SELECT blob FROM manifests WHERE blob IN (${marks(part.length)})`)
      .all(...part))
      found.add(row.blob);
  return found;
};

const settled = new Set<string>();

const learn = (root: string, entries: readonly { readonly path: string; readonly blob: string }[]): void => {
  const database = databaseAt(root);
  const sources = entries.filter((one) => !isManifest(one.path));
  const manifests = entries.filter((one) => isManifest(one.path));
  const sourcesHeld = heldFacts(
    database,
    sources.map((one) => one.blob),
  );
  const manifestsHeld = heldManifests(
    database,
    manifests.map((one) => one.blob),
  );
  const seen = new Set<string>();
  const wanted = [
    ...sources.filter((one) => !sourcesHeld.has(`${one.blob}\0${classOf(one.path)}`)),
    ...manifests.filter((one) => !manifestsHeld.has(one.blob)),
  ].filter((one) => {
    const key = `${one.blob}\0${isManifest(one.path) ? 'm' : classOf(one.path)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const texts = blobTexts(
    root,
    wanted.map((one) => one.blob),
  );
  const insertFacts = database.query('INSERT OR IGNORE INTO facts (blob, class, data) VALUES (?, ?, ?)');
  const insertLink = database.query('INSERT OR IGNORE INTO links (stem, blob, spec) VALUES (?, ?, ?)');
  const insertShape = database.query('INSERT OR IGNORE INTO shapes (key, blob) VALUES (?, ?)');
  const insertManifest = database.query('INSERT OR IGNORE INTO manifests (blob, data) VALUES (?, ?)');
  const insertPlace = database.query('INSERT OR IGNORE INTO places (blob, path) VALUES (?, ?)');
  database.transaction(() => {
    for (const one of wanted) {
      const text = texts.get(one.blob)!;
      if (isManifest(one.path)) {
        insertManifest.run(one.blob, JSON.stringify(packageOf(one.path, text) ?? null));
        continue;
      }
      const facts = factsOf(one.path, text);
      insertFacts.run(one.blob, classOf(one.path), JSON.stringify(pack(facts)));
      for (const [stem, spec] of linksOfFacts(facts)) insertLink.run(stem, one.blob, spec);
      for (const shape of facts.shapes) insertShape.run(`${shape.kind}:${shape.key}`, one.blob);
    }
    for (const one of entries) insertPlace.run(one.blob, one.path);
  })();
};

const LIMIT = 80_000;

const pruned = (root: string, entries: readonly Blobbed[], tree: string): void => {
  const database = databaseAt(root);
  const total = database.query<{ count: number }, []>('SELECT count(*) AS count FROM facts').get()!.count;
  if (total <= LIMIT) return;
  database.exec('CREATE TEMP TABLE IF NOT EXISTS keeping (blob TEXT PRIMARY KEY) WITHOUT ROWID');
  database.exec('DELETE FROM keeping');
  const insert = database.query('INSERT OR IGNORE INTO keeping (blob) VALUES (?)');
  database.transaction(() => {
    for (const one of entries) insert.run(one.blob);
    for (const table of ['facts', 'places', 'links', 'shapes', 'manifests'])
      database.exec(`DELETE FROM ${table} WHERE blob NOT IN (SELECT blob FROM keeping)`);
    database.query('DELETE FROM indexed WHERE tree != ?').run(tree);
  })();
  settled.clear();
};

const populated = (root: string, tree: string): void => {
  const entries: { path: string; blob: string }[] = [];
  for (const [path, entry] of entriesAt(root, tree, [], true))
    if (regular(entry) && indexable(path)) entries.push({ path, blob: entry.object });
  learn(root, entries);
  pruned(root, entries, tree);
};

export const changesBetween = (root: string, base: string, tree: string): readonly Change[] => {
  const output = git(root, ['diff-tree', '-r', '-z', '--raw', '--no-renames', '--no-abbrev', base, tree]).toString().split('\0');
  const changes: Change[] = [];
  for (let at = 0; at + 1 < output.length; at += 2) {
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) /.exec(output[at]!);
    if (match === null) continue;
    const zero = (id: string): string | null => (/^0+$/.test(id) ? null : id);
    const regularMode = (mode: string): boolean => mode === '100644' || mode === '100755' || mode === '000000';
    if (!regularMode(match[1]!) || !regularMode(match[2]!)) continue;
    changes.push({ path: output[at + 1]!, before: zero(match[3]!), after: zero(match[4]!) });
  }
  return changes;
};

const isIndexed = (root: string, tree: string): boolean =>
  settled.has(`${root}\0${tree}`) || databaseAt(root).query('SELECT 1 FROM indexed WHERE tree = ?').get(tree) !== null;

const mark = (root: string, tree: string): void => {
  databaseAt(root).query('INSERT OR REPLACE INTO indexed (tree, at) VALUES (?, ?)').run(tree, Date.now());
  settled.add(`${root}\0${tree}`);
};

const NEARBY = 6;

const GOOD_ENOUGH = 50;

const FAR = 5000;

const ensure = (root: string, tree: string, hint: string | null): void => {
  if (isIndexed(root, tree)) return;
  const recent = databaseAt(root)
    .query<{ tree: string }, [number]>('SELECT tree FROM indexed ORDER BY at DESC LIMIT ?')
    .all(NEARBY)
    .map((one) => one.tree);
  let best: { readonly source: string; readonly changes: readonly Change[] } | undefined;
  for (const source of [...new Set([...(hint !== null && isIndexed(root, hint) ? [hint] : []), ...recent])]) {
    const changes = changesBetween(root, source, tree);
    if (best === undefined || changes.length < best.changes.length) best = { source, changes };
    if (changes.length < GOOD_ENOUGH) break;
  }
  if (best === undefined || best.changes.length > FAR) {
    populated(root, tree);
    mark(root, tree);
    return;
  }
  learn(
    root,
    best.changes.flatMap((one) => (one.after !== null && indexable(one.path) ? [{ path: one.path, blob: one.after }] : [])),
  );
  derivedManifests(root, best.source, tree, best.changes);
  mark(root, tree);
};

export const prepare = (root: string, tree: string, base: string | null): void => {
  if (base !== null) ensure(root, base, null);
  ensure(root, tree, base);
};

export type Blobbed = { readonly path: string; readonly blob: string };

export const factsAt = (root: string, entries: readonly Blobbed[]): Map<string, Facts> => {
  const database = databaseAt(root);
  const facts = new Map<string, Facts>();
  const byBlob = new Map<string, Blobbed[]>();
  for (const one of entries) {
    const held = byBlob.get(one.blob);
    if (held === undefined) byBlob.set(one.blob, [one]);
    else held.push(one);
  }
  for (const part of chunks([...byBlob.keys()]))
    for (const row of database
      .query<{ blob: string; class: string; data: string }, string[]>(
        `SELECT blob, class, data FROM facts WHERE blob IN (${marks(part.length)})`,
      )
      .all(...part)) {
      const unpacked = unpack(JSON.parse(row.data) as Packed);
      for (const one of byBlob.get(row.blob)!) if (classOf(one.path) === row.class) facts.set(one.path, unpacked);
    }
  return facts;
};

export const packagesAt = (root: string, entries: readonly Blobbed[]): Package[] => {
  const database = databaseAt(root);
  const found: Package[] = [];
  const blobs = [...new Set(entries.map((one) => one.blob))];
  const rows = new Map<string, Package | null>();
  for (const part of chunks(blobs))
    for (const row of database
      .query<{ blob: string; data: string }, string[]>(`SELECT blob, data FROM manifests WHERE blob IN (${marks(part.length)})`)
      .all(...part))
      rows.set(row.blob, JSON.parse(row.data) as Package | null);
  for (const one of entries) {
    const text = rows.get(one.blob);
    if (text === undefined || text === null) continue;
    found.push({ ...text, dir: posix.dirname(one.path) === '.' ? '' : posix.dirname(one.path) });
  }
  return found;
};

export const listing = (root: string, tree: string): readonly Blobbed[] => {
  const entries: Blobbed[] = [];
  for (const [path, entry] of entriesAt(root, tree, [], true))
    if (regular(entry) && indexable(path)) entries.push({ path, blob: entry.object });
  return entries;
};

const DIRECTORY_LISTING = 24;

const byLookup = (root: string, commit: string, rows: readonly Blobbed[]): Blobbed[] => {
  if (rows.length === 0) return [];
  const checked = git(root, ['cat-file', '--batch-check=%(objectname)'], `${rows.map((one) => `${commit}:${one.path}`).join('\n')}\n`)
    .toString()
    .split('\n');
  return rows.filter((one, at) => checked[at] === one.blob);
};

const standing = (root: string, commit: string, rows: readonly Blobbed[]): Blobbed[] => {
  if (rows.length <= DIRECTORY_LISTING) return byLookup(root, commit, rows);
  const nested = rows.filter((one) => posix.dirname(one.path) !== '.');
  const listed = entriesAt(root, commit, [...new Set(nested.map((one) => `${posix.dirname(one.path)}/`))], false);
  return [
    ...nested.filter((one) => listed.get(one.path)?.object === one.blob),
    ...byLookup(
      root,
      commit,
      rows.filter((one) => posix.dirname(one.path) === '.'),
    ),
  ];
};

const placed = (database: Database, blobs: readonly string[]): Blobbed[] => {
  const rows: Blobbed[] = [];
  for (const part of chunks(blobs))
    rows.push(...database.query<Blobbed, string[]>(`SELECT path, blob FROM places WHERE blob IN (${marks(part.length)})`).all(...part));
  return rows;
};

export const importersOf = (
  root: string,
  commit: string,
  targets: ReadonlySet<string>,
  packages: readonly Package[],
  aliases: readonly Alias[],
  accepts: (path: string) => boolean,
): Blobbed[] => {
  const database = databaseAt(root);
  const stems = new Set<string>([GLOB, '.']);
  for (const path of targets) {
    for (const stem of stemsOfFile(path)) stems.add(stem);
    for (const stem of keyStems(packages, path)) stems.add(stem);
  }
  const resolver = resolverOf(targets, packages, aliases);
  const rows = new Map<string, Blobbed>();
  for (const part of chunks([...stems]))
    for (const row of database
      .query<{ spec: string; path: string; blob: string }, string[]>(
        `SELECT l.spec AS spec, p.path AS path, p.blob AS blob FROM links l JOIN places p ON p.blob = l.blob WHERE l.stem IN (${marks(part.length)})`,
      )
      .all(...part))
      if (accepts(row.path) && !rows.has(row.path) && (row.spec === '' || resolver.resolve(row.spec, row.path).length > 0))
        rows.set(row.path, { path: row.path, blob: row.blob });
  return standing(root, commit, [...rows.values()]);
};

export const sharingShapes = (root: string, commit: string, keys: readonly string[]): Blobbed[] => {
  const database = databaseAt(root);
  const blobs = new Set<string>();
  for (const part of chunks([...new Set(keys)]))
    for (const row of database
      .query<{ blob: string }, string[]>(`SELECT blob FROM shapes WHERE key IN (${marks(part.length)})`)
      .all(...part))
      blobs.add(row.blob);
  return standing(
    root,
    commit,
    placed(database, [...blobs]).filter((one) => isSource(one.path)),
  );
};

const manifestKey = (commit: string): string => `declarations/manifests/${commit}`;

const manifestEntries = (root: string, commit: string): readonly Blobbed[] => {
  const held = revisionAt(root, manifestKey(commit)) as readonly Blobbed[] | undefined;
  if (held !== undefined) return held;
  const rows = databaseAt(root).query<Blobbed, []>('SELECT path, blob FROM places WHERE blob IN (SELECT blob FROM manifests)').all();
  const found = standing(
    root,
    commit,
    rows.filter((one) => isManifest(one.path)),
  );
  saveRevision(root, manifestKey(commit), found);
  return found;
};

const derivedManifests = (root: string, base: string, tree: string, changes: readonly Change[]): void => {
  const found = new Map(manifestEntries(root, base).map((one) => [one.path, one.blob]));
  for (const one of changes)
    if (isManifest(one.path)) {
      if (one.after === null) found.delete(one.path);
      else found.set(one.path, one.after);
    }
  saveRevision(
    root,
    manifestKey(tree),
    [...found].map(([path, blob]) => ({ path, blob })),
  );
};

export const manifestsAt = (root: string, commit: string): Package[] => packagesAt(root, manifestEntries(root, commit));
