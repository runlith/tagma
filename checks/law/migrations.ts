import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import type { Finding } from '@runlith/tagma/rules';
import { Option, Result, Schema } from 'effect';
import {
  ASIDE_FILE,
  AsideDeclared,
  DROPPING,
  migrationIssues,
  renamedIn,
  unreturnedIssues,
} from '../../apps/tagma/server/src/platform/store/migrationLaw';
import { BACK_SCRIPT } from '@runlith/sqlite-process/chainReturn';
import type { Declaration } from './declarations';
import { blobTexts, changedBetween, type Entry, entriesAt, git, mentioning, present } from './git';

const Params = Schema.Struct({
  source: Schema.String,
  folder: Schema.String,
  cut: Schema.String,
});

const MENTIONS = 'sqliteTable|manifest|formSteps|tables';
const MIGRATION = /^\d{14}_[^/]+\/migration\.sql$/;
const KEPT = 4;
const CARRIED = 512;

const Form = Schema.Struct({ name: Schema.String, path: Schema.String, line: Schema.Number });
const Contribution = Schema.Struct({
  reads: Schema.Record(Schema.String, Schema.String),
  tables: Schema.Array(Schema.Struct({ symbol: Schema.String, name: Schema.String })),
  histories: Schema.Array(Schema.String),
  forms: Schema.Array(Form),
  lenient: Schema.Boolean,
});
type Contribution = typeof Contribution.Type;
const Scan = Schema.Struct({
  source: Schema.String,
  snapshot: Schema.String,
  scanned: Schema.Array(Schema.String),
  objects: Schema.Record(Schema.String, Schema.String),
});
type Scan = typeof Scan.Type;
const Keyed = Schema.Struct({
  key: Schema.String,
  findings: Schema.Array(Schema.Struct({ fingerprint: Schema.String, message: Schema.String })),
});
type Keyed = typeof Keyed.Type;
const Memo = Schema.Struct({
  version: Schema.String,
  scans: Schema.Array(Scan),
  contributions: Schema.Record(Schema.String, Contribution),
  keys: Schema.Array(Keyed),
});

type Side = 'tree' | 'base';
type Analysis = { readonly history: readonly string[]; readonly forms: readonly (typeof Form.Type)[] };

const candidate = (source: string, path: string): boolean =>
  path.startsWith(`${source}/`) &&
  path.endsWith('.ts') &&
  !/\.(test|itest|e2e|stest|spec|bench|fixture)\.ts$/.test(path) &&
  !path.includes('/testing/');

const declares = (text: string): boolean =>
  text.includes('\\') ||
  text.includes('sqliteTable') ||
  (text.includes('manifest') && (text.includes('formSteps') || text.includes('tables')));

const unavailable = (failure: unknown): boolean =>
  failure instanceof SyntaxError || (failure instanceof Error && typeof (failure as NodeJS.ErrnoException).code === 'string');

const storedAt = (file: string): Option.Option<typeof Memo.Type> => {
  try {
    return existsSync(file) ? Schema.decodeUnknownOption(Memo)(JSON.parse(readFileSync(file, 'utf8'))) : Option.none();
  } catch (failure) {
    if (unavailable(failure)) return Option.none();
    throw failure;
  }
};

const regular = (path: string, entry: Entry): void => {
  if (entry.kind !== 'blob' || !['100644', '100755'].includes(entry.mode))
    throw new Error(`${path} is not a regular source file (${entry.mode} ${entry.kind})`);
};

const snapshotAt = (root: string, id: string) => {
  if (!/^[0-9a-f]{40,64}$/.test(id)) throw new Error(`not a git object id: ${id}`);
  const entries = new Map<string, Entry | null>();
  const texts = new Map<string, string>();
  const list = (paths: readonly string[]): void => {
    const unknown = [...new Set(paths)].filter((path) => !entries.has(path));
    if (unknown.length === 0) return;
    const listed = entriesAt(root, id, unknown, false);
    for (const path of unknown) entries.set(path, listed.get(path) ?? null);
  };
  const load = (paths: readonly string[]): void => {
    list(paths);
    const objects = paths.map((path) => {
      const entry = entries.get(path);
      if (entry === null || entry === undefined) throw new Error(`${path} is missing from ${id}`);
      regular(path, entry);
      return entry.object;
    });
    for (const [object, text] of blobTexts(
      root,
      objects.filter((object) => !texts.has(object)),
    ))
      texts.set(object, text);
  };
  return {
    id,
    known: (listed: ReadonlyMap<string, Entry>): void => {
      for (const [path, entry] of listed) entries.set(path, entry);
    },
    list,
    entry: (path: string): Entry | undefined => {
      list([path]);
      return entries.get(path) ?? undefined;
    },
    load,
    has: (path: string): boolean => {
      list([path]);
      const entry = entries.get(path);
      return entry !== null && entry !== undefined && entry.kind !== 'tree';
    },
    read: (path: string): string => {
      load([path]);
      return texts.get(entries.get(path)!.object)!;
    },
  };
};
type Snapshot = ReturnType<typeof snapshotAt>;

const memoAt = (root: string) => {
  const directory = join(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim(), 'runlith-law');
  const file = join(directory, 'migrations.json');
  const version = createHash('sha256')
    .update(readFileSync(join(import.meta.dir, 'migrations.ts')))
    .update(readFileSync(join(import.meta.dir, 'declarations.ts')))
    .update(readFileSync(join(import.meta.dir, 'git.ts')))
    .digest('hex');
  const stored = Option.filter(storedAt(file), (memo) => memo.version === version);
  let scans = Option.isSome(stored) ? [...stored.value.scans] : [];
  const contributions = new Map(Option.isSome(stored) ? Object.entries(stored.value.contributions) : []);
  let keys = Option.isSome(stored) ? [...stored.value.keys] : [];
  let changed = false;
  return {
    scans: (source: string) => scans.filter((one) => one.source === source),
    contribution: (key: string) => contributions.get(key),
    contribute: (key: string, contribution: Contribution) => {
      contributions.set(key, contribution);
      changed = true;
    },
    scanned: (scan: Scan) => {
      scans = [scan, ...scans.filter((one) => one.source !== scan.source || one.snapshot !== scan.snapshot)].slice(0, KEPT);
      changed = true;
    },
    key: (key: string) => keys.find((one) => one.key === key),
    keep: (keyed: Keyed) => {
      keys = [keyed, ...keys.filter((one) => one.key !== keyed.key)].slice(0, KEPT);
      changed = true;
    },
    save: () => {
      if (!changed) return;
      const held = new Set(scans.flatMap((scan) => scan.scanned.map((path) => `${scan.objects[path]} ${path}`)));
      const written = `${file}.${process.pid}.${crypto.randomUUID()}`;
      let created = false;
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          written,
          JSON.stringify({ version, scans, contributions: Object.fromEntries([...contributions].filter(([key]) => held.has(key))), keys }),
        );
        created = true;
        renameSync(written, file);
      } catch (failure) {
        if (!unavailable(failure)) throw failure;
        if (created) rmSync(written, { force: true });
      }
    },
  };
};
type Store = ReturnType<typeof memoAt>;

const derived = (root: string, from: Scan, to: Snapshot): Scan | undefined => {
  const changed = changedBetween(root, from.snapshot, to.id);
  const fresh = changed.filter((path) => candidate(from.source, path));
  if (fresh.length > CARRIED) return undefined;
  const moved = new Set(changed);
  const scanned = [
    ...from.scanned.filter((path) => !moved.has(path)),
    ...(fresh.length === 0 ? [] : mentioning(root, to.id, MENTIONS, fresh)),
  ].sort();
  const objects: Record<string, string> = {};
  for (const [path, object] of Object.entries(from.objects)) if (!moved.has(path)) objects[path] = object;
  const scanning = new Set(scanned);
  const relisted = changed.filter((path) => path in from.objects || scanning.has(path));
  to.list(relisted);
  for (const path of relisted) {
    const entry = to.entry(path);
    if (entry !== undefined) objects[path] = entry.object;
  }
  return { source: from.source, snapshot: to.id, scanned, objects };
};

const scanOf = (root: string, store: Store, judged: ReadonlySet<string>, source: string, snapshot: Snapshot): Scan => {
  const known = store.scans(source);
  const exact = known.find((one) => one.snapshot === snapshot.id);
  if (exact !== undefined) return exact;
  const near = known.slice(0, 3);
  const alive = present(
    root,
    near.map((one) => one.snapshot).filter((one) => !judged.has(one)),
  );
  for (const one of near) {
    if (!judged.has(one.snapshot) && !alive.has(one.snapshot)) continue;
    const scan = derived(root, one, snapshot);
    if (scan !== undefined) return scan;
  }
  const scanned = mentioning(root, snapshot.id, MENTIONS, [source])
    .filter((path) => candidate(source, path))
    .sort();
  snapshot.list(scanned);
  const objects: Record<string, string> = {};
  for (const path of scanned) objects[path] = snapshot.entry(path)!.object;
  return { source, snapshot: snapshot.id, scanned, objects };
};

const analyst = (root: string, store: Store, judged: ReadonlySet<string>) => {
  const done = new Map<string, Analysis>();
  return async (source: string, side: Side, snapshot: Snapshot): Promise<Analysis> => {
    const id = JSON.stringify([source, side, snapshot.id]);
    const finished = done.get(id);
    if (finished !== undefined) return finished;
    const scan = scanOf(root, store, judged, source, snapshot);
    const objects = { ...scan.objects };
    const held = scan.scanned.map((path) => store.contribution(`${objects[path]} ${path}`));
    snapshot.list(held.flatMap((one) => (one === undefined ? [] : Object.keys(one.reads).filter((path) => !(path in objects)))));
    const objectAt = (path: string): string | undefined => objects[path] ?? snapshot.entry(path)?.object;
    const valid = (one: Contribution | undefined): one is Contribution =>
      one !== undefined &&
      (side === 'base' || !one.lenient) &&
      Object.entries(one.reads).every(([path, object]) => objectAt(path) === object);
    const stale = scan.scanned.filter((_, at) => !valid(held[at]));
    const declarations: { path: string; declaration: Declaration }[] = [];
    snapshot.load(stale);
    const declaring = stale.filter((path) => {
      if (declares(snapshot.read(path))) return true;
      store.contribute(`${objects[path]} ${path}`, {
        reads: { [path]: objects[path]! },
        tables: [],
        histories: [],
        forms: [],
        lenient: false,
      });
      return false;
    });
    if (declaring.length > 0) {
      const { declarationOf } = await import('./declarations');
      for (const path of declaring) {
        const reads: Record<string, string> = {};
        const declaration = declarationOf(
          {
            has: snapshot.has,
            read: (read) => {
              reads[read] = snapshot.entry(read)!.object;
              return snapshot.read(read);
            },
          },
          path,
          side,
        );
        store.contribute(`${objects[path]} ${path}`, { ...declaration, reads });
      }
    }
    for (const path of scan.scanned) {
      const contribution = store.contribution(`${objects[path]} ${path}`)!;
      for (const read of Object.keys(contribution.reads)) objects[read] = contribution.reads[read]!;
      declarations.push({ path, declaration: contribution });
    }
    store.scanned({ ...scan, objects });
    const tables = new Map<string, string>();
    const histories = new Set<string>();
    const forms = new Map<string, typeof Form.Type>();
    for (const { path, declaration } of declarations) {
      for (const { symbol, name } of declaration.tables) {
        const previous = tables.get(symbol);
        if (previous !== undefined && previous !== name) throw new Error(`${path}: ambiguous table symbol ${symbol}`);
        tables.set(symbol, name);
      }
      for (const symbol of declaration.histories) histories.add(symbol);
      for (const form of declaration.forms) {
        if (forms.has(form.name)) throw new Error(`${form.path}: repeated form step ${form.name}`);
        forms.set(form.name, form);
      }
    }
    const analysis: Analysis = {
      history: [
        ...new Set(
          [...histories].map((symbol) => {
            const name = tables.get(symbol);
            if (name === undefined) throw new Error(`history table ${symbol} has no sqliteTable declaration`);
            return name.toLowerCase();
          }),
        ),
      ],
      forms: [...forms.values()],
    };
    done.set(id, analysis);
    return analysis;
  };
};

const migrationsAt = (snapshot: Snapshot, root: string, folder: string) => {
  const listed = entriesAt(root, snapshot.id, [folder], true);
  snapshot.known(listed);
  const paths = [...listed.keys()].filter((path) => MIGRATION.test(path.slice(folder.length + 1))).sort();
  const digest = createHash('sha256')
    .update(JSON.stringify([...listed].map(([path, entry]) => [path, entry.mode, entry.object]).sort()))
    .digest('hex');
  return { listed, paths, digest };
};

const statementsOf = (text: string): string[] => text.split('--> statement-breakpoint').filter((one) => one.trim() !== '');

const backFailure = (chain: readonly string[], back: string): string | null => {
  const db = new Database(':memory:');
  try {
    db.run('PRAGMA foreign_keys = OFF');
    for (const text of chain) for (const statement of statementsOf(text)) db.run(statement);
    for (const statement of statementsOf(back)) db.run(statement);
    return null;
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  } finally {
    db.close();
  }
};

type Shape = ReadonlyMap<string, ReadonlySet<string>>;

const shapeOf = (db: Database): Shape =>
  new Map(
    db
      .query<{ name: string }, []>(
        `select name from pragma_table_list where schema = 'main' and type = 'table' and name not like 'sqlite_%'`,
      )
      .all()
      .map(({ name }) => [
        name.toLowerCase(),
        new Set(
          db
            .query<{ name: string }, [string]>('select name from pragma_table_info(?)')
            .all(name)
            .map((column) => column.name.toLowerCase()),
        ),
      ]),
  );

type Dropped = { readonly table: string; readonly columns: readonly string[] | null };

const droppedBy = (before: Shape, after: Shape, statements: readonly string[]): readonly Dropped[] => {
  const renamed = renamedIn(statements);
  return [...before].flatMap(([table, columns]): Dropped[] => {
    if (renamed.tables.has(table)) return [];
    const standing = after.get(table);
    if (standing === undefined) return [{ table, columns: null }];
    const gone = [...columns].filter((column) => !standing.has(column) && renamed.columns.get(table)?.has(column) !== true);
    return gone.length === 0 ? [] : [{ table, columns: gone }];
  });
};

const decodeAside = Schema.decodeUnknownResult(Schema.fromJsonString(AsideDeclared));

const unkept = (tree: Snapshot, migrations: ReturnType<typeof migrationsAt>, added: ReadonlySet<string>): readonly Finding[] => {
  const asides = [...added].map((path) => path.replace(/migration\.sql$/, ASIDE_FILE)).filter((path) => migrations.listed.has(path));
  tree.load([...migrations.paths, ...asides]);
  const findings: Finding[] = [];
  const db = new Database(':memory:');
  try {
    db.run('PRAGMA foreign_keys = OFF');
    for (const path of migrations.paths) {
      const statements = statementsOf(tree.read(path));
      const before = added.has(path) ? shapeOf(db) : null;
      for (const statement of statements) db.run(statement);
      if (before === null) continue;
      const at = path.replace(/migration\.sql$/, ASIDE_FILE);
      const read = migrations.listed.has(at) ? decodeAside(tree.read(at)) : null;
      if (read !== null && Result.isFailure(read)) {
        findings.push({
          path: at,
          line: 1,
          fingerprint: `${path}: aside unread`,
          message: `${ASIDE_FILE} does not read, so it keeps nothing: ${String(read.failure)}`,
        });
        continue;
      }
      const declared = read === null ? null : read.success;
      const kept = new Set([...(declared?.tables ?? []), ...(declared?.derived ?? [])].map((table) => table.toLowerCase()));
      for (const drop of droppedBy(before, shapeOf(db), statements)) {
        if (kept.has(drop.table)) continue;
        const what = drop.columns === null ? 'the migration drops the table' : `the migration drops ${drop.columns.join(', ')}`;
        findings.push({
          path,
          line: 1,
          fingerprint: `${path}: drops ${drop.table}${drop.columns === null ? '' : ` ${drop.columns.join(',')}`}`,
          message: `${drop.table}: ${what}, and no ${ASIDE_FILE} beside it keeps the table or names it derived, so a step back would bring it back empty`,
        });
      }
    }
  } catch (failure) {
    findings.push({
      path: [...added][0]!,
      line: 1,
      fingerprint: `${[...added][0]}: chain unapplied`,
      message: `the chain does not apply in memory, so what its new migrations drop cannot be judged: ${failure instanceof Error ? failure.message : String(failure)}`,
    });
  } finally {
    db.close();
  }
  return findings;
};

const foreignKeys = (
  store: Store,
  snapshot: Snapshot,
  migrations: ReturnType<typeof migrationsAt>,
  history: ReadonlySet<string>,
): Keyed['findings'] => {
  const key = `${migrations.digest} ${JSON.stringify([...history].sort())}`;
  const held = store.key(key);
  if (held !== undefined) return held.findings;
  snapshot.load(migrations.paths);
  const db = new Database(':memory:');
  const findings: { fingerprint: string; message: string }[] = [];
  try {
    for (const path of migrations.paths) for (const statement of statementsOf(snapshot.read(path))) db.exec(statement);
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    for (const table of history) {
      const keys = db.query<{ id: number; seq: number; from: string }, []>(`pragma foreign_key_list(${quote(table)})`).all();
      const indexes = db
        .query<{ name: string; partial: number }, []>(`pragma index_list(${quote(table)})`)
        .all()
        .filter((index) => index.partial === 0)
        .map((index) =>
          db
            .query<{ name: string | null }, []>(`pragma index_info(${quote(index.name)})`)
            .all()
            .map((column) => column.name),
        );
      const primary = db
        .query<{ name: string; pk: number }, []>(`pragma table_info(${quote(table)})`)
        .all()
        .filter((column) => column.pk > 0)
        .sort((one, other) => one.pk - other.pk)
        .map((column) => column.name);
      indexes.push(primary);
      for (const id of new Set(keys.map((one) => one.id))) {
        const columns = keys
          .filter((one) => one.id === id)
          .sort((one, other) => one.seq - other.seq)
          .map((one) => one.from);
        if (!indexes.some((index) => columns.every((column, at) => index[at] === column)))
          findings.push({
            fingerprint: `history foreign key ${table}(${columns.join(',')})`,
            message: `${table}: foreign key (${columns.join(', ')}) has no full leading-column index`,
          });
      }
    }
  } finally {
    db.close();
  }
  store.keep({ key, findings });
  return findings;
};

export type MigrationsParams = typeof Params.Encoded;

const Placed = Schema.Struct({ source: Schema.String });

export type StepPlacesParams = typeof Placed.Encoded;

const Backs = Schema.Struct({ folders: Schema.Array(Schema.String), cut: Schema.String });

export type MigrationBacksParams = typeof Backs.Encoded;

const addedMigrations = (
  migrations: ReturnType<typeof migrationsAt>,
  before: ReturnType<typeof migrationsAt> | null,
  cut: string,
): readonly string[] => migrations.paths.filter((path) => (before === null ? path.split('/').at(-2)! > cut : !before.listed.has(path)));

export type StoredKey = { readonly key: string; readonly id: string; readonly params: unknown };

export type StoredReading = { readonly key: string; readonly side: Side; readonly findings: readonly Finding[] };

export const storedJudge = (root: string, treeAt: string, baseAt: string | null) => {
  const store = memoAt(root);
  const analysisOf = analyst(root, store, new Set([treeAt, ...(baseAt === null ? [] : [baseAt])]));
  const snapshots = new Map<Side, Snapshot>();
  const snapshotOf = (side: Side): Snapshot => {
    let snapshot = snapshots.get(side);
    if (snapshot === undefined) {
      snapshot = snapshotAt(root, side === 'tree' ? treeAt : baseAt!);
      snapshots.set(side, snapshot);
    }
    return snapshot;
  };
  const ordered: readonly Side[] = baseAt === null ? ['tree'] : ['base', 'tree'];
  const judge = async (key: StoredKey): Promise<StoredReading[]> => {
    const readings: StoredReading[] = [];
    if (key.id === 'step-places') {
      const { source } = Schema.decodeUnknownSync(Placed, { onExcessProperty: 'error' })(key.params);
      for (const side of ordered) {
        const analysis = await analysisOf(source, side, snapshotOf(side));
        const findings: Finding[] = analysis.forms
          .filter((at) => !at.path.includes('/steps/'))
          .map(({ name, ...at }) => ({
            ...at,
            fingerprint: `${at.path}: form step ${name} outside steps`,
            message: `form step ${name} is declared in live code; it belongs in its module's steps/ folder`,
          }));
        readings.push({ key: key.key, side, findings });
      }
      return readings;
    }
    if (key.id === 'migration-backs') {
      const params = Schema.decodeUnknownSync(Backs, { onExcessProperty: 'error' })(key.params);
      const tree = snapshotOf('tree');
      const base = baseAt === null ? null : snapshotOf('base');
      const findings: Finding[] = [];
      for (const folder of params.folders) {
        const migrations = migrationsAt(tree, root, folder);
        const added = addedMigrations(migrations, base === null ? null : migrationsAt(base, root, folder), params.cut);
        const scripted = added.filter((path) => migrations.listed.has(path.replace(/migration\.sql$/, BACK_SCRIPT)));
        if (scripted.length > 0) {
          tree.load(migrations.paths);
          for (const path of scripted) {
            const failure = backFailure(
              migrations.paths.slice(0, migrations.paths.indexOf(path) + 1).map((one) => tree.read(one)),
              tree.read(path.replace(/migration\.sql$/, BACK_SCRIPT)),
            );
            if (failure !== null)
              findings.push({
                path: path.replace(/migration\.sql$/, BACK_SCRIPT),
                line: 1,
                fingerprint: `${path}: back script ${failure}`,
                message: `${BACK_SCRIPT} does not run on the shape its migration leaves, so a step back would fail on a person's machine: ${failure}`,
              });
          }
        }
        if (added.length > 0) findings.push(...unkept(tree, migrations, new Set(added)));
        const unscripted = added.filter((path) => !scripted.includes(path));
        tree.load(unscripted);
        for (const path of unscripted)
          for (const issue of unreturnedIssues(statementsOf(tree.read(path))).filter((one) => !DROPPING.has(one.reason)))
            findings.push({
              path,
              line: 1,
              fingerprint: `${path}: back ${issue.table ?? 'unresolved'} ${issue.statement.trim()}`,
              message: `${issue.table ?? 'unknown target'}: ${issue.reason}, and no ${BACK_SCRIPT} stands beside it to return it: ${issue.statement.trim()}`,
            });
      }
      return [{ key: key.key, side: 'tree', findings }];
    }
    if (key.id !== 'migrations') throw new Error(`unknown migration check ${key.id}`);
    const params = Schema.decodeUnknownSync(Params, { onExcessProperty: 'error' })(key.params);
    const tree = snapshotOf('tree');
    const base = baseAt === null ? null : snapshotOf('base');
    const previous = base === null ? null : await analysisOf(params.source, 'base', base);
    const current = await analysisOf(params.source, 'tree', tree);
    const history = new Set(current.history);
    const migrations = migrationsAt(tree, root, params.folder);
    const before = base === null ? null : migrationsAt(base, root, params.folder);
    const findings: Finding[] = [];
    const added = addedMigrations(migrations, before, params.cut);
    tree.load(added);
    for (const path of added) {
      const metadata = path.replace(/migration\.sql$/, 'heavy.json');
      const reason = migrations.listed.has(metadata)
        ? Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.NonEmptyString }), { onExcessProperty: 'error' })(
            JSON.parse(tree.read(metadata)),
          ).reason
        : undefined;
      for (const statement of statementsOf(tree.read(path)))
        for (const issue of migrationIssues(statement, history))
          if (reason === undefined || issue.table === null)
            findings.push({
              path,
              line: 1,
              fingerprint: `${path}: ${issue.table ?? 'unresolved'} ${statement.trim()}`,
              message: `${issue.table ?? 'unknown target'}: ${issue.reason}: ${statement.trim()}`,
            });
    }
    if (findings.length === 0 && migrations.paths.length > 0) {
      const path = added.at(-1) ?? migrations.paths.at(-1)!;
      for (const one of foreignKeys(store, tree, migrations, history)) findings.push({ path, line: 1, ...one });
    }
    const last =
      previous === null
        ? undefined
        : previous.forms
            .map((one) => one.name)
            .sort()
            .at(-1);
    if (previous !== null && last !== undefined) {
      const landed = new Set(previous.forms.map((one) => one.name));
      for (const { name, ...at } of current.forms)
        if (!landed.has(name) && name <= last)
          findings.push({
            ...at,
            fingerprint: `${at.path}: form step ${name}`,
            message: `form step ${name} must follow the already landed ${last}`,
          });
    }
    readings.push({ key: key.key, side: 'tree', findings });
    if (base !== null && previous !== null && before !== null) {
      const path = before.paths.at(-1);
      readings.push({
        key: key.key,
        side: 'base',
        findings:
          path === undefined
            ? []
            : foreignKeys(store, base, before, new Set([...previous.history, ...current.history])).map((one) => ({
                path,
                line: 1,
                ...one,
              })),
      });
    }
    return readings;
  };
  return { judge, save: store.save };
};
