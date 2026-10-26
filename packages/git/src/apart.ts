import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, type Scope } from 'effect';
import type { Git } from './Git.js';
import { blobsAt } from './entries.js';
import { run, runEnded, commandFor, GitUnreadable, type GitAnswerInvalid, type GitRefused } from './repository.js';
import { diffTreeAt, type TreeDifference } from './trees.js';
import { type MergeSides, type MergeTree, mergeFileAt, mergedIn, mergeTreeArgs, OBJECT } from './merge.js';

type Failed = GitUnreadable | GitRefused | GitAnswerInvalid;

export type SideFile = { readonly path: string; readonly mode: string; readonly text: string };

export type Conflicted = {
  readonly path: string;
  readonly base: SideFile | null;
  readonly ours: SideFile | null;
  readonly theirs: SideFile | null;
};

export type SettlingFiles = {
  readonly conflicts: readonly Conflicted[];
  readonly arrived: { readonly ours: readonly SideFile[]; readonly theirs: readonly SideFile[] };
  readonly left: readonly SideFile[];
};

export type SettlingMerge = {
  readonly text: string;
  readonly conflicted: boolean;
};

export type Settling = SettlingFiles & {
  readonly merge: (sides: readonly MergeSides[]) => Effect.Effect<readonly SettlingMerge[], Failed>;
};

export type SettledFile = { readonly path: string; readonly mode: string; readonly text: string | null };

export type Settled = {
  readonly files: readonly SettledFile[];
  readonly yielded: readonly string[];
};

export type MergeDriver = {
  readonly name: string;
  readonly sides: (sides: readonly MergeSides[]) => Effect.Effect<readonly MergeSides[], Failed>;
  readonly settle?: (settling: Settling) => Effect.Effect<Settled | null, Failed>;
};

const REGULAR = new Set(['100644', '100755']);

type Side = keyof MergeSides;

const SIDES: readonly Side[] = ['base', 'ours', 'theirs'];

type Staged = { readonly mode: string; readonly object: string };

type Stages = Partial<Record<Side, Staged>>;

type StagedTree = { readonly tree: string; readonly stages: ReadonlyMap<string, Stages> };

const STAGE_SIDES: Readonly<Record<string, Side>> = { '1': 'base', '2': 'ours', '3': 'theirs' };

const stagedIn = Effect.fn('Git.stagedIn')(function* (
  git: Git['Service'],
  dir: string,
  args: readonly string[],
  capture: number | undefined,
): Effect.fn.Return<StagedTree, Failed> {
  const ended = yield* runEnded(git, dir, args, capture, [1]);
  const [tree = '', ...records] = ended.stdout.split('\0');
  const stages = new Map<string, Stages>();
  for (const record of records) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode = '', object = '', stage = ''] = record.slice(0, Math.max(tab, 0)).split(' ');
    const side = STAGE_SIDES[stage];
    if (tab < 0 || side === undefined || !OBJECT.test(object)) {
      return yield* new GitUnreadable({
        command: commandFor(dir, args),
        reason: `merge-tree printed a conflicted entry this reader cannot frame: ${record}`,
      });
    }
    const path = record.slice(tab + 1);
    stages.set(path, { ...stages.get(path), [side]: { mode, object } });
  }
  if (!OBJECT.test(tree) || (ended.status === 1) !== stages.size > 0) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'merge-tree printed no tree this reader can frame' });
  }
  return { tree, stages };
});

type Driven = {
  readonly path: string;
  readonly mode: string;
  readonly ours: string;
  readonly objects: MergeSides;
};

type Drives = {
  readonly base: string;
  readonly paths: readonly Driven[];
  readonly mine: readonly TreeDifference[];
  readonly other: readonly TreeDifference[];
};

type Scratch = {
  readonly root: string;
  readonly files: (texts: readonly string[]) => Effect.Effect<readonly string[], GitUnreadable>;
  readonly bare: (object: string) => Effect.Effect<string, GitUnreadable>;
};

const scratchOf = (dir: string): Effect.Effect<Scratch, GitUnreadable, Scope.Scope> => {
  const unready = (cause: unknown) =>
    new GitUnreadable({ command: commandFor(dir, ['merge-tree']), reason: `the merge's scratch could not be written: ${String(cause)}` });
  return Effect.map(
    Effect.acquireRelease(Effect.tryPromise({ try: () => mkdtemp(join(tmpdir(), 'merge-tree-')), catch: unready }), (root) =>
      Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
    (root) => {
      let made = 0;
      return {
        root,
        files: (texts) =>
          Effect.tryPromise({
            try: async () => {
              const paths = texts.map(() => join(root, `blob-${(made += 1)}`));
              await Promise.all(texts.map((text, at) => writeFile(paths[at] as string, text)));
              return paths;
            },
            catch: unready,
          }),
        bare: (object) =>
          Effect.tryPromise({
            try: async () => {
              const bare = join(root, 'bare');
              await Promise.all([
                mkdir(join(bare, 'objects'), { recursive: true }),
                mkdir(join(bare, 'refs'), { recursive: true }),
                mkdir(join(bare, 'info'), { recursive: true }),
              ]);
              await writeFile(join(bare, 'HEAD'), 'ref: refs/heads/main\n');
              if (object.length === 64)
                await writeFile(join(bare, 'config'), '[core]\nrepositoryformatversion = 1\n[extensions]\nobjectFormat = sha256\n');
              await writeFile(join(bare, 'info', 'attributes'), '* merge=text\n');
              return bare;
            },
            catch: unready,
          }),
      };
    },
  );
};

type Places = { readonly gitDir: string; readonly objects: string };

const placesOf = Effect.fn('Git.mergePlaces')(function* (
  git: Git['Service'],
  dir: string,
  capture: number | undefined,
): Effect.fn.Return<Places, Failed> {
  const args = ['rev-parse', '--path-format=absolute', '--git-dir', '--git-path', 'objects'];
  const lines = (yield* run(git, dir, args, capture)).split('\n');
  const [gitDir, objects] = lines;
  if (lines.length !== 3 || lines[2] !== '' || gitDir === undefined || gitDir === '' || objects === undefined || objects === '') {
    return yield* new GitUnreadable({
      command: commandFor(dir, args),
      reason: 'rev-parse printed no git dir and object store this reader can frame',
    });
  }
  return { gitDir, objects };
});

const foreignDrivers = Effect.fn('Git.foreignDrivers')(function* (
  git: Git['Service'],
  dir: string,
  own: string | undefined,
  capture: number | undefined,
): Effect.fn.Return<boolean, Failed> {
  const ended = yield* runEnded(git, dir, ['config', '-z', '--get-regexp', '^merge\\..*\\.driver$'], capture, [1]);
  return nulRecords(ended.stdout).some((record) => record.split('\n')[0] !== `merge.${own}.driver`);
});

const nulRecords = (stdout: string): readonly string[] => stdout.split('\0').filter((record) => record !== '');

const attributedAt = Effect.fn('Git.attributed')(function* (
  git: Git['Service'],
  dir: string,
  source: string,
  paths: readonly string[],
  driver: string,
  capture: number | undefined,
): Effect.fn.Return<ReadonlySet<string>, Failed> {
  const listed = yield* run(
    git,
    dir,
    ['--work-tree=.', `--attr-source=${source}`, 'check-attr', '-z', '--stdin', 'merge'],
    capture,
    paths.map((path) => `${path}\0`).join(''),
  );
  const fields = listed.split('\0');
  const named = new Set<string>();
  for (let at = 0; at + 2 < fields.length; at += 3) if (fields[at + 2] === driver) named.add(fields[at] as string);
  return named;
});

const modified = (change: TreeDifference | undefined): change is TreeDifference & { readonly mode: string } =>
  change !== undefined && change.status === 'M' && change.after !== null && change.mode !== null && REGULAR.has(change.mode);

const drivenAt = Effect.fn('Git.driven')(function* (
  git: Git['Service'],
  dir: string,
  scratch: Scratch,
  ours: string,
  theirs: string,
  driver: MergeDriver,
  capture: number | undefined,
): Effect.fn.Return<Drives | null, Failed> {
  const ended = yield* runEnded(git, dir, ['merge-base', '--all', '--end-of-options', ours, theirs], capture, [1]);
  const bases = ended.stdout.split('\n').filter((line) => line !== '');
  const base = bases[0];
  if (base === undefined || bases.length !== 1) return null;
  const [mine, other] = yield* Effect.all([diffTreeAt(git, dir, base, ours), diffTreeAt(git, dir, base, theirs)], { concurrency: 2 });
  const across = new Map(other.map((change) => [change.path, change]));
  const both = mine.flatMap((change) => {
    const there = across.get(change.path);
    return modified(change) && modified(there) && there.mode === change.mode && there.after !== change.after ? [change] : [];
  });
  if (both.length === 0) return { base, paths: [], mine, other };
  const named = yield* attributedAt(
    git,
    dir,
    ours,
    both.map((change) => change.path),
    driver.name,
    capture,
  );
  const chosen = both.filter((change) => named.has(change.path));
  if (chosen.length === 0) return { base, paths: [], mine, other };
  const read = yield* blobsAt(
    git,
    dir,
    chosen.flatMap((change) => [base, ours, theirs].map((tree) => ({ tree, path: change.path }))),
    { capture },
  );
  const taken: {
    readonly change: (typeof chosen)[number];
    readonly objects: MergeSides;
    readonly before: MergeSides;
  }[] = [];
  for (const [at, change] of chosen.entries()) {
    const [was, mine, other] = [read[at * 3], read[at * 3 + 1], read[at * 3 + 2]];
    if (was?.status !== 'text' || mine?.status !== 'text' || other?.status !== 'text') continue;
    const before = { base: was.text, ours: mine.text, theirs: other.text };
    const objects = { base: was.object, ours: mine.object, theirs: other.object };
    taken.push({ change, objects, before });
  }
  const reconciled = yield* driver.sides(taken.map(({ before }) => before));
  const prepared = taken.map((one, at) => ({ ...one, after: reconciled[at]! }));
  const rewritten = prepared.flatMap(({ before, after }) => SIDES.flatMap((side) => (after[side] === before[side] ? [] : [after[side]])));
  const written = rewritten.length === 0 ? [] : yield* objectsWritten(git, dir, scratch, rewritten, capture);
  let next = 0;
  const paths = prepared.map(({ change, objects, before, after }): Driven => {
    const object = (side: Side): string => (after[side] === before[side] ? objects[side] : (written[next++] as string));
    const sided = { base: object('base'), ours: object('ours'), theirs: object('theirs') };
    return { path: change.path, mode: change.mode, ours: objects.ours, objects: sided };
  });
  return { base, paths, mine, other };
});

const objectsWritten = Effect.fn('Git.objectsWritten')(function* (
  git: Git['Service'],
  dir: string,
  scratch: Scratch,
  texts: readonly string[],
  capture: number | undefined,
  known: Map<string, string> = new Map(),
): Effect.fn.Return<readonly string[], Failed> {
  const missing = [...new Set(texts.filter((text) => !known.has(text)))];
  if (missing.length > 0) {
    const files = yield* scratch.files(missing);
    const args = ['hash-object', '-w', '--no-filters', '--stdin-paths'];
    const objects = (yield* run(git, dir, args, capture, files.map((file) => `${file}\n`).join('')))
      .split('\n')
      .filter((line) => line !== '');
    if (objects.length !== missing.length || !objects.every((object) => OBJECT.test(object))) {
      return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'hash-object printed no object for each text' });
    }
    for (const [at, text] of missing.entries()) known.set(text, objects[at]!);
  }
  return texts.map((text) => known.get(text)!);
});

const treeMade = Effect.fn('Git.treeMade')(function* (
  git: Git['Service'],
  dir: string,
  entries: readonly { readonly name: string; readonly object: string }[],
  capture: number | undefined,
): Effect.fn.Return<string, Failed> {
  const args = ['mktree', '-z'];
  const tree = (yield* run(git, dir, args, capture, entries.map(({ name, object }) => `100644 blob ${object}\t${name}\0`).join(''))).trim();
  if (!OBJECT.test(tree)) return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'mktree printed no tree' });
  return tree;
});

const treeEdited = Effect.fn('Git.treeEdited')(function* (
  git: Git['Service'],
  dir: string,
  scratch: Scratch,
  tree: string,
  entries: readonly { readonly path: string; readonly mode: string; readonly object: string }[],
  capture: number | undefined,
): Effect.fn.Return<string, Failed> {
  const env = { GIT_INDEX_FILE: join(scratch.root, `index-${tree}`) };
  yield* runEnded(git, dir, ['read-tree', '--end-of-options', tree], capture, [], { env });
  const records = entries.map(({ path, mode, object }) => `${mode} ${object}\t${path}\0`).join('');
  yield* runEnded(git, dir, ['update-index', '-z', '--index-info'], capture, [], { env, stdin: records });
  const args = ['write-tree'];
  const written = (yield* runEnded(git, dir, args, capture, [], { env })).stdout.trim();
  if (!OBJECT.test(written)) return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'write-tree printed no tree' });
  return written;
});

export const mergeTreeApart = Effect.fn('Git.mergeTreeApart')(function* (
  git: Git['Service'],
  dir: string,
  ours: string,
  theirs: string,
  options: { readonly driver?: MergeDriver; readonly capture?: number } = {},
): Effect.fn.Return<MergeTree, Failed> {
  const { capture } = options;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scratch = yield* scratchOf(dir);
      const [places, foreign] = yield* Effect.all([placesOf(git, dir, capture), foreignDrivers(git, dir, options.driver?.name, capture)], {
        concurrency: 2,
      });
      const cwd = foreign ? dir : scratch.root;
      const merged = (left: string, right: string, base?: string) =>
        stagedIn(git, cwd, [`--git-dir=${places.gitDir}`, `--attr-source=${ours}`, ...mergeTreeArgs(left, right, base, false)], capture);
      const driver = options.driver;
      const driven = driver === undefined ? null : yield* drivenAt(git, dir, scratch, ours, theirs, driver, capture);
      if (driver === undefined || driven === null) {
        const plain = yield* merged(ours, theirs);
        return { tree: plain.tree, conflicts: [...plain.stages.keys()], yielded: [] };
      }
      const { base, paths } = driven;
      const apart =
        paths.length === 0
          ? { rest: yield* merged(ours, theirs), stages: new Map<string, Stages>(), moved: Effect.succeed<readonly Edit[]>([]) }
          : yield* drivenApart(git, dir, scratch, places, { ours, theirs, base, paths }, merged, capture);
      const conflicts = new Map([...apart.rest.stages, ...apart.stages]);
      if (conflicts.size === 0) {
        const moved = yield* apart.moved;
        const tree = moved.length === 0 ? apart.rest.tree : yield* treeEdited(git, dir, scratch, apart.rest.tree, moved, capture);
        return { tree, conflicts: [], yielded: [] };
      }
      const settling =
        driver.settle === undefined
          ? null
          : yield* settlingAt(git, dir, scratch, places, driver, { ours, theirs, driven, conflicts }, capture);
      const settled = driver.settle === undefined || settling === null ? null : yield* driver.settle(settling.input);
      if (settled === null || settling === null) return { tree: apart.rest.tree, conflicts: [...conflicts.keys()], yielded: [] };
      const texts = settled.files.flatMap((file) => (file.text === null ? [] : [file.text]));
      const objects = texts.length === 0 ? [] : yield* objectsWritten(git, dir, scratch, texts, capture, settling.objects);
      const gone = '0'.repeat(apart.rest.tree.length);
      const edits = new Map((yield* apart.moved).map((edit) => [edit.path, edit] as const));
      let written = 0;
      for (const file of settled.files) {
        const object = file.text === null ? gone : (objects[written++] as string);
        edits.set(file.path, { path: file.path, mode: file.text === null ? '0' : file.mode, object });
      }
      const tree = yield* treeEdited(git, dir, scratch, apart.rest.tree, [...edits.values()], capture);
      return { tree, conflicts: [], yielded: settled.yielded };
    }),
  );
});

type Edit = { readonly path: string; readonly mode: string; readonly object: string };

const drivenApart = Effect.fn('Git.drivenApart')(function* (
  git: Git['Service'],
  dir: string,
  scratch: Scratch,
  places: Places,
  at: { readonly ours: string; readonly theirs: string; readonly base: string; readonly paths: readonly Driven[] },
  merged: (left: string, right: string, base?: string) => Effect.Effect<StagedTree, Failed>,
  capture: number | undefined,
) {
  const { paths } = at;
  const theirsAside = yield* treeEdited(
    git,
    dir,
    scratch,
    at.theirs,
    paths.map(({ path, mode, ours: object }) => ({ path, mode, object })),
    capture,
  );
  const made = (side: Side) =>
    treeMade(
      git,
      dir,
      paths.map(({ objects }, index) => ({ name: String(index), object: objects[side] })),
      capture,
    );
  const [rest, [baseSides, oursSides, theirsSides], bare] = yield* Effect.all(
    [merged(at.ours, theirsAside, at.base), Effect.all([made('base'), made('ours'), made('theirs')]), scratch.bare(paths[0]!.objects.base)],
    { concurrency: 2 },
  );
  const sides = yield* mergedIn(git, scratch.root, [`--git-dir=${bare}`, ...mergeTreeArgs(oursSides, theirsSides, baseSides)], capture, {
    GIT_OBJECT_DIRECTORY: places.objects,
  });
  const moved = Effect.gen(function* () {
    const args = ['ls-tree', '-z', '--end-of-options', sides.tree];
    const results = new Map(
      nulRecords(yield* run(git, dir, args, capture)).map((record) => {
        const tab = record.indexOf('\t');
        return [record.slice(tab + 1), record.slice(0, tab).split(' ')[2] ?? ''] as const;
      }),
    );
    const edits: Edit[] = [];
    for (const [index, { path, mode, ours: object }] of paths.entries()) {
      const result = results.get(String(index));
      if (result === undefined || !OBJECT.test(result)) {
        return yield* new GitUnreadable({ command: commandFor(dir, args), reason: `the merged tree names no blob for ${path}` });
      }
      if (result !== object) edits.push({ path, mode, object: result });
    }
    return edits as readonly Edit[];
  });
  const stages = new Map(
    sides.conflicts.flatMap((name) => {
      const one = paths[Number(name)];
      if (one === undefined) return [[name, {} as Stages] as const];
      const staged = (side: Side): Staged => ({ mode: one.mode, object: one.objects[side] });
      return [[one.path, { base: staged('base'), ours: staged('ours'), theirs: staged('theirs') } as Stages] as const];
    }),
  );
  return { rest, stages, moved };
});

const settledMerges = Effect.fn('Git.settledMerges')(function* (
  git: Git['Service'],
  dir: string,
  scratch: Scratch,
  places: Places,
  texts: readonly MergeSides[],
  capture: number | undefined,
  known: Map<string, string>,
): Effect.fn.Return<readonly SettlingMerge[], Failed> {
  if (texts.length === 0) return [];
  const binary = texts.find((sides) => SIDES.some((side) => sides[side].slice(0, 8000).includes('\0')));
  if (binary !== undefined) yield* mergeFileAt(git, dir, binary, { capture });
  const objects = yield* objectsWritten(
    git,
    dir,
    scratch,
    texts.flatMap((sides) => SIDES.map((side) => sides[side])),
    capture,
    known,
  );
  const made = (side: Side) =>
    treeMade(
      git,
      dir,
      texts.map((_, at) => ({ name: String(at), object: objects[at * 3 + SIDES.indexOf(side)]! })),
      capture,
    );
  const [base, ours, theirs] = yield* Effect.all([made('base'), made('ours'), made('theirs')]);
  const bare = yield* scratch.bare(base);
  const merge = (favor: boolean) =>
    mergedIn(
      git,
      scratch.root,
      [
        `--git-dir=${bare}`,
        'merge-tree',
        '-Xdiff-algorithm=myers',
        ...(favor ? ['-Xours'] : []),
        ...mergeTreeArgs(ours, theirs, base).slice(1),
      ],
      capture,
      { GIT_OBJECT_DIRECTORY: places.objects },
    );
  const clean = yield* merge(false);
  const favored = clean.conflicts.length === 0 ? clean : yield* merge(true);
  const conflicted = new Set(clean.conflicts);
  const read = yield* blobsAt(
    git,
    dir,
    texts.map((_, at) => ({ tree: favored.tree, path: String(at) })),
    { capture },
  );
  const merged: SettlingMerge[] = [];
  for (const [at] of texts.entries()) {
    const answer = read[at];
    if (answer?.status !== 'text') {
      return yield* new GitUnreadable({
        command: commandFor(dir, ['merge-tree']),
        reason: `the merged texts name no readable blob for ${at}`,
      });
    }
    known.set(answer.text, answer.object);
    merged.push({ text: answer.text, conflicted: conflicted.has(String(at)) });
  }
  return merged;
});

type PreparedSettling = { readonly input: Settling; readonly objects: Map<string, string> };

const settlingAt = Effect.fn('Git.settling')(function* (
  git: Git['Service'],
  dir: string,
  scratch: Scratch,
  places: Places,
  driver: MergeDriver,
  at: {
    readonly ours: string;
    readonly theirs: string;
    readonly driven: Drives;
    readonly conflicts: ReadonlyMap<string, Stages>;
  },
  capture: number | undefined,
): Effect.fn.Return<PreparedSettling | null, Failed> {
  const { driven } = at;
  const conflicts = [...at.conflicts.keys()];
  const added = (changes: readonly TreeDifference[]) => changes.filter((change) => change.status === 'A' && change.mode !== null);
  const [oursAdded, theirsAdded] = [added(driven.mine), added(driven.other)];
  const removed = [...new Set([...driven.mine, ...driven.other].filter((change) => change.status === 'D').map((change) => change.path))];
  const named = yield* attributedAt(
    git,
    dir,
    at.ours,
    [...new Set([...conflicts, ...oursAdded.map((change) => change.path), ...theirsAdded.map((change) => change.path), ...removed])],
    driver.name,
    capture,
  );
  if (!conflicts.every((path) => named.has(path))) return null;
  const trees = { base: driven.base, ours: at.ours, theirs: at.theirs } as const;
  type Asked = { readonly side: Side; readonly path: string; readonly mode: string };
  const sided = conflicts.flatMap((path) =>
    SIDES.flatMap((side) => {
      const staged = at.conflicts.get(path)?.[side];
      return staged === undefined ? [] : [{ side, path, mode: staged.mode, object: staged.object }];
    }),
  );
  const around: Asked[] = [
    ...oursAdded.flatMap((change) =>
      named.has(change.path) ? [{ side: 'ours' as const, path: change.path, mode: change.mode as string }] : [],
    ),
    ...theirsAdded.flatMap((change) =>
      named.has(change.path) ? [{ side: 'theirs' as const, path: change.path, mode: change.mode as string }] : [],
    ),
    ...removed.flatMap((path) => (named.has(path) ? [{ side: 'base' as const, path, mode: '100644' }] : [])),
  ];
  const read = yield* blobsAt(
    git,
    dir,
    [...sided.map(({ object }) => ({ object })), ...around.map(({ side, path }) => ({ tree: trees[side], path }))],
    { capture },
  );
  const conflicted = new Map(conflicts.map((path) => [path, { path, base: null, ours: null, theirs: null } as Conflicted]));
  for (const [index, one] of sided.entries()) {
    const answer = read[index];
    if (answer?.status !== 'text') return null;
    const standing = conflicted.get(one.path) as Conflicted;
    conflicted.set(one.path, { ...standing, [one.side]: { path: one.path, mode: one.mode, text: answer.text } });
  }
  const arrivals = around.flatMap((one, index) => {
    const answer = read[sided.length + index];
    return answer?.status === 'text' ? [{ side: one.side, file: { path: one.path, mode: one.mode, text: answer.text } }] : [];
  });
  const of = (side: Side): readonly SideFile[] => arrivals.flatMap((one) => (one.side === side ? [one.file] : []));
  const objects = new Map(read.flatMap((one) => (one.status === 'text' ? [[one.text, one.object] as const] : [])));
  return {
    input: {
      conflicts: [...conflicted.values()],
      arrived: { ours: of('ours'), theirs: of('theirs') },
      left: of('base'),
      merge: (sides) => Effect.flatMap(driver.sides(sides), (texts) => settledMerges(git, dir, scratch, places, texts, capture, objects)),
    },
    objects,
  };
});
