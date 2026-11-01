import { createRequire } from 'node:module';
import { posix } from 'node:path';
import type { Database } from 'bun:sqlite';
import type { TreeDifference } from '@runlith/git/trees';
import type { BlobAt } from '@runlith/git/working';
import { directoriesAt, listedAt, prepareDirectories } from '../directories';
import { blobTexts, type Entry, git } from '../git';
import { derivedMap, rootAt, seededMap, valueAt } from '../maps';
import { databaseAt } from '../store';
import { type Packed, pack, unpack } from './compact';
import { ancestorsOf, isManifest, isSource, keysReaching, type Package, type Packages, packageOf, shapeOf, targetKeys } from './corpus';
import type { Facts } from './facts';
import { type Alias, keyStems, resolverOf } from './resolve';

const load = createRequire(import.meta.url);

let reader: typeof import('./read') | undefined;

const factsOf = (path: string, text: string): Facts => (reader ??= load('./read.ts') as typeof import('./read')).factsOf(path, text);

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

const pruned = (root: string, entries: readonly BlobAt[], tree: string): void => {
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
  for (const [path, entry] of listedAt(root, tree, [], true))
    if (regular(entry) && indexable(path)) entries.push({ path, blob: entry.object });
  learn(root, entries);
  pruned(root, entries, tree);
  seededMap(
    root,
    PACKAGES,
    tree,
    packageRows(
      packagesAt(
        root,
        entries.filter((one) => isManifest(one.path)),
      ),
    ),
  );
};

export const changesBetween = (root: string, base: string, tree: string): readonly TreeDifference[] => {
  const output = git(root, ['diff-tree', '-r', '-z', '--raw', '--no-renames', '--no-abbrev', base, tree]).toString().split('\0');
  const changes: TreeDifference[] = [];
  for (let at = 0; at + 1 < output.length; at += 2) {
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) (\S+)$/.exec(output[at]!);
    if (match === null) continue;
    const zero = (id: string): string | null => (/^0+$/.test(id) ? null : id);
    const regularMode = (mode: string): boolean => mode === '100644' || mode === '100755';
    const before = regularMode(match[1]!) ? zero(match[3]!) : null;
    const after = regularMode(match[2]!) ? zero(match[4]!) : null;
    if (before === null && after === null) continue;
    changes.push({ path: output[at + 1]!, before, after, mode: match[2]!, status: match[5]! });
  }
  return changes;
};

const PACKAGES = 'packages';

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const reverseKeys = (one: Package): readonly string[] => [`n:${one.name}`, ...targetKeys(one).map((key) => `x:${key}`)];

const packageRows = (packages: readonly Package[]): (readonly [string, unknown])[] => {
  const reverse = new Map<string, string[]>();
  for (const one of packages)
    for (const key of reverseKeys(one)) {
      const held = reverse.get(key);
      if (held === undefined) reverse.set(key, [one.dir]);
      else held.push(one.dir);
    }
  return [
    ...packages.map((one) => [`m:${one.dir}`, one] as const),
    ...[...reverse].map(([key, dirs]) => [key, dirs.sort(byText)] as const),
  ];
};

const KEPT_INDEXED = 256;

export const indexedAt = (root: string, tree: string): boolean =>
  (settled.has(`${root}\0${tree}`) || databaseAt(root).query('SELECT 1 FROM indexed WHERE tree = ?').get(tree) !== null) &&
  rootAt(root, PACKAGES, tree) !== undefined;

const mark = (root: string, tree: string): void => {
  const database = databaseAt(root);
  database.transaction(() => {
    database.query('INSERT OR REPLACE INTO indexed (tree, at) VALUES (?, ?)').run(tree, Date.now());
    database.query('DELETE FROM indexed WHERE tree IN (SELECT tree FROM indexed ORDER BY at DESC LIMIT -1 OFFSET ?)').run(KEPT_INDEXED);
  })();
  settled.add(`${root}\0${tree}`);
};

const NEARBY = 6;

export const GOOD_ENOUGH = 50;

export const FAR = 5000;

export class WholeRequired extends Error {}

const ensure = (root: string, tree: string, hint: string | null, populate: boolean): void => {
  if (indexedAt(root, tree)) return;
  const recent = databaseAt(root)
    .query<{ tree: string }, [number]>('SELECT tree FROM indexed ORDER BY at DESC LIMIT ?')
    .all(NEARBY)
    .map((one) => one.tree);
  let best: { readonly source: string; readonly changes: readonly TreeDifference[] } | undefined;
  for (const source of [...new Set([...(hint !== null && indexedAt(root, hint) ? [hint] : []), ...recent])].filter((one) =>
    indexedAt(root, one),
  )) {
    const changes = changesBetween(root, source, tree);
    if (best === undefined || changes.length < best.changes.length) best = { source, changes };
    if (changes.length < GOOD_ENOUGH) break;
  }
  if (best === undefined || best.changes.length > FAR) {
    if (!populate)
      throw new WholeRequired(
        `the declaration index holds no revision within ${FAR} changed files of ${tree}; run check_rules with inspection "dead-code" over "change", using the same paths, whole and taking selection as the refused landing, to prepare the candidate before judging it again`,
      );
    populated(root, tree);
    mark(root, tree);
    return;
  }
  learn(
    root,
    best.changes.flatMap((one) => (one.after !== null && indexable(one.path) ? [{ path: one.path, blob: one.after }] : [])),
  );
  derivedPackages(root, best.source, tree, best.changes);
  mark(root, tree);
};

export const prepare = (root: string, tree: string, base: string | null): void => {
  if (base === null) {
    prepareDirectories(root, tree, null);
    ensure(root, tree, null, true);
    return;
  }
  ensure(root, base, null, false);
  prepareDirectories(root, tree, base);
  ensure(root, tree, base, false);
};

export const factsAt = (root: string, entries: readonly BlobAt[]): Map<string, Facts> => {
  const database = databaseAt(root);
  const facts = new Map<string, Facts>();
  const byBlob = new Map<string, BlobAt[]>();
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

export const packagesAt = (root: string, entries: readonly BlobAt[]): Package[] => {
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

export const listing = (root: string, tree: string): readonly BlobAt[] => {
  const entries: BlobAt[] = [];
  for (const [path, entry] of listedAt(root, tree, [], true))
    if (regular(entry) && indexable(path)) entries.push({ path, blob: entry.object });
  return entries;
};

const DIRECTORY_LISTING = 24;

const byLookup = (root: string, commit: string, rows: readonly BlobAt[]): BlobAt[] => {
  if (rows.length === 0) return [];
  const checked = git(root, ['cat-file', '--batch-check=%(objectname)'], `${rows.map((one) => `${commit}:${one.path}`).join('\n')}\n`)
    .toString()
    .split('\n');
  return rows.filter((one, at) => checked[at] === one.blob);
};

export const blobsAt = (root: string, commit: string, paths: readonly string[]): Map<string, string> => {
  const found = new Map<string, string>();
  const prepared = directoriesAt(root, commit);
  if (prepared !== undefined) {
    for (const path of paths) {
      const entry = prepared.entry(path);
      if (entry !== undefined && regular(entry)) found.set(path, entry.object);
    }
    return found;
  }
  const looked = (wanted: readonly string[]): void => {
    if (wanted.length === 0) return;
    const checked = git(
      root,
      ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      `${wanted.map((one) => `${commit}:${one}`).join('\n')}\n`,
    )
      .toString()
      .split('\n');
    wanted.forEach((path, at) => {
      const match = /^([0-9a-f]{40,64}) blob$/.exec(checked[at] ?? '');
      if (match !== null) found.set(path, match[1]!);
    });
  };
  if (paths.length <= DIRECTORY_LISTING) {
    looked(paths);
    return found;
  }
  const nested = paths.filter((one) => posix.dirname(one) !== '.');
  const listed = listedAt(root, commit, [...new Set(nested.map((one) => `${posix.dirname(one)}/`))], false);
  for (const path of nested) {
    const entry = listed.get(path);
    if (entry !== undefined && regular(entry)) found.set(path, entry.object);
  }
  looked(paths.filter((one) => posix.dirname(one) === '.'));
  return found;
};

const standing = (root: string, commit: string, rows: readonly BlobAt[]): BlobAt[] => {
  const prepared = directoriesAt(root, commit);
  if (prepared !== undefined) return rows.filter((one) => prepared.entry(one.path)?.object === one.blob);
  if (rows.length <= DIRECTORY_LISTING) return byLookup(root, commit, rows);
  const nested = rows.filter((one) => posix.dirname(one.path) !== '.');
  const listed = listedAt(root, commit, [...new Set(nested.map((one) => `${posix.dirname(one.path)}/`))], false);
  return [
    ...nested.filter((one) => listed.get(one.path)?.object === one.blob),
    ...byLookup(
      root,
      commit,
      rows.filter((one) => posix.dirname(one.path) === '.'),
    ),
  ];
};

const placed = (database: Database, blobs: readonly string[]): BlobAt[] => {
  const rows: BlobAt[] = [];
  for (const part of chunks(blobs))
    rows.push(...database.query<BlobAt, string[]>(`SELECT path, blob FROM places WHERE blob IN (${marks(part.length)})`).all(...part));
  return rows;
};

export const importersOf = (
  root: string,
  commit: string,
  targets: ReadonlySet<string>,
  packages: Packages,
  aliases: readonly Alias[],
  accepts: (path: string) => boolean,
): BlobAt[] => {
  const database = databaseAt(root);
  const stems = new Set<string>([GLOB, '.']);
  for (const path of targets) {
    for (const stem of stemsOfFile(path)) stems.add(stem);
    for (const stem of keyStems(packages, path)) stems.add(stem);
  }
  const resolver = resolverOf(targets, packages, aliases);
  const rows = new Map<string, BlobAt>();
  for (const part of chunks([...stems]))
    for (const row of database
      .query<{ spec: string; path: string; blob: string }, string[]>(
        `SELECT l.spec AS spec, p.path AS path, p.blob AS blob FROM links l JOIN places p ON p.blob = l.blob WHERE l.stem IN (${marks(part.length)})`,
      )
      .all(...part))
      if (
        accepts(row.path) &&
        !rows.has(`${row.path}\0${row.blob}`) &&
        (row.spec === '' || resolver.resolve(row.spec, row.path).length > 0)
      )
        rows.set(`${row.path}\0${row.blob}`, { path: row.path, blob: row.blob });
  return standing(root, commit, [...rows.values()]);
};

export const importersByName = (root: string, commit: string, names: readonly string[], accepts: (path: string) => boolean): BlobAt[] => {
  const database = databaseAt(root);
  const rows = new Map<string, BlobAt>();
  for (const name of names)
    for (const row of database
      .query<BlobAt, [string, number, string]>(
        'SELECT DISTINCT p.path AS path, p.blob AS blob FROM links l JOIN places p ON p.blob = l.blob WHERE l.spec = ?1 OR substr(l.spec, 1, ?2) = ?3',
      )
      .all(name, name.length + 1, `${name}/`))
      if (accepts(row.path)) rows.set(`${row.path}\0${row.blob}`, row);
  return standing(root, commit, [...rows.values()]);
};

export const sharingShapes = (root: string, commit: string, keys: readonly string[]): BlobAt[] => {
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

const dirOf = (path: string): string => (posix.dirname(path) === '.' ? '' : posix.dirname(path));

const noPackages = (commit: string): Error =>
  new Error(`the declaration index holds no packages of ${commit}; build it with check_rules over "all", then judge the change again`);

const derivedPackages = (root: string, base: string, tree: string, changes: readonly TreeDifference[]): void => {
  const from = rootAt(root, PACKAGES, base);
  if (from === undefined) throw noPackages(base);
  const manifests = changes.filter((one) => isManifest(one.path));
  const now = new Map(
    packagesAt(
      root,
      manifests.flatMap((one) => (one.after === null ? [] : [{ path: one.path, blob: one.after }])),
    ).map((one) => [one.dir, one]),
  );
  const rows = new Map<string, unknown>();
  const changed = new Set(manifests.map((one) => dirOf(one.path)));
  const keys = new Set<string>();
  for (const dir of changed) {
    const was = valueAt(root, from, `m:${dir}`) as Package | undefined;
    const is = now.get(dir);
    rows.set(`m:${dir}`, is);
    for (const one of [was, is]) if (one !== undefined) for (const key of reverseKeys(one)) keys.add(key);
  }
  for (const key of keys) {
    const standing = (valueAt(root, from, key) as readonly string[] | undefined) ?? [];
    const dirs = new Set(standing.filter((dir) => !changed.has(dir)));
    for (const dir of changed) {
      const is = now.get(dir);
      if (is !== undefined && reverseKeys(is).includes(key)) dirs.add(dir);
    }
    rows.set(key, dirs.size === 0 ? undefined : [...dirs].sort(byText));
  }
  derivedMap(root, PACKAGES, tree, from, rows);
};

const catalogs = new Map<string, Packages>();

export const manifestsAt = (root: string, commit: string): Packages => {
  const id = rootAt(root, PACKAGES, commit);
  if (id === undefined) throw noPackages(commit);
  const key = `${root}\0${id}`;
  const known = catalogs.get(key);
  if (known !== undefined) return known;
  const dirs = new Map<string, Package | undefined>();
  const at = (dir: string): Package | undefined => {
    if (!dirs.has(dir)) dirs.set(dir, valueAt(root, id, `m:${dir}`) as Package | undefined);
    return dirs.get(dir);
  };
  const names = new Map<string, Package | undefined>();
  const made: Packages = {
    at,
    named: (name) => {
      if (!names.has(name)) {
        const held = valueAt(root, id, `n:${name}`) as readonly string[] | undefined;
        names.set(name, held === undefined ? undefined : at(held[held.length - 1]!));
      }
      return names.get(name);
    },
    containing: (path) => ancestorsOf(path).flatMap((dir) => at(dir) ?? []),
    targeting: (path) => {
      const found = new Set<string>();
      for (const key of keysReaching(path))
        for (const dir of (valueAt(root, id, `x:${key}`) as readonly string[] | undefined) ?? []) found.add(dir);
      return [...found].sort(byText).flatMap((dir) => at(dir) ?? []);
    },
  };
  if (catalogs.size > 64) catalogs.clear();
  catalogs.set(key, made);
  return made;
};

export const movedPackages = (
  root: string,
  base: string,
  tree: string,
  changes: readonly TreeDifference[],
): { readonly before: readonly Package[]; readonly after: readonly Package[] } => {
  const was = manifestsAt(root, base);
  const is = manifestsAt(root, tree);
  const before: Package[] = [];
  const after: Package[] = [];
  for (const dir of new Set(changes.filter((one) => isManifest(one.path)).map((one) => dirOf(one.path)))) {
    const left = was.at(dir);
    const right = is.at(dir);
    if (left !== undefined && (right === undefined || shapeOf(left) !== shapeOf(right))) before.push(left);
    if (right !== undefined && (left === undefined || shapeOf(left) !== shapeOf(right))) after.push(right);
  }
  return { before, after };
};
