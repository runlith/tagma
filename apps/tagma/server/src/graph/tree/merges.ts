import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Clock, Effect, Schema } from 'effect';
import { OwnGitFailed } from '../../platform/git/ownGit.js';
import { graphRecoverySchema, type GraphRecovery } from '../contract/wire/recovery.js';
import { canon, type ShadowGit } from './shadow.js';
import { type TreeShape, validateTree } from './validation.js';
import { FORMAT_FILE, TREE_MERGES } from '../contract/wire/storage.js';
import { readMarker } from './marker.js';

const tracked = (incoming: string): boolean => incoming.startsWith('refs/');

const recordSchema = Schema.Struct({
  ...graphRecoverySchema.fields,
  conflicts: Schema.NullOr(Schema.Array(Schema.String)),
  relocating: Schema.Boolean,
  ready: Schema.NullOr(Schema.String),
  published: Schema.NullOr(Schema.String),
});
type Record = typeof recordSchema.Type;

const recordsIn = (shadow: ShadowGit): string => join(shadow.gitDir, TREE_MERGES);

const io = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (cause) => new OwnGitFailed({ op: 'graph-recovery', message: String(cause), ran: false }),
  });

const failed = (message: string) => new OwnGitFailed({ op: 'graph-recovery', message, ran: true });

const recordAt = (file: string): Effect.Effect<Record | null, OwnGitFailed> =>
  Effect.flatMap(
    io(() => readFile(file, 'utf8').catch((cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? null : Promise.reject(cause)))),
    (text) =>
      text === null
        ? Effect.succeed(null)
        : Schema.decodeUnknownEffect(Schema.fromJsonString(recordSchema))(text).pipe(
            Effect.mapError((cause) => new OwnGitFailed({ op: 'graph-recovery', message: `${file}: ${cause.message}`, ran: false })),
          ),
  );

const readAt = (file: string): Effect.Effect<GraphRecovery | null, OwnGitFailed> =>
  Effect.map(recordAt(file), (record) => {
    if (record === null || record.published !== null) return null;
    const { relocating: _, published: __, ready: ___, conflicts, ...recovery } = record;
    return conflicts === null ? null : { ...recovery, conflicts };
  });

const records = Effect.fnUntraced(function* (shadow: ShadowGit) {
  const directory = recordsIn(shadow);
  const names = yield* io(() =>
    readdir(directory).catch((cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? [] : Promise.reject(cause))),
  );
  const found: Record[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = yield* recordAt(join(directory, name));
    if (record !== null) found.push(record);
  }
  return found;
});

const heldBy = (shadow: ShadowGit, twin: string, kept: ReadonlySet<string>) =>
  Effect.map(
    shadow.run('recovery-holders', [
      '--git-dir',
      shadow.gitDir,
      'for-each-ref',
      '--contains',
      `refs/heads/${twin}`,
      '--format=%(refname:short)',
      'refs/heads',
    ]),
    (holders) => holders.split('\n').some((holder) => holder !== twin && kept.has(holder)),
  );

const fileOf = (shadow: ShadowGit, treeRoot: string) => join(recordsIn(shadow), `${Bun.hash(treeRoot).toString(16)}.json`);

const discard = Effect.fnUntraced(function* (shadow: ShadowGit, file: string, record: Record) {
  if (existsSync(join(record.path, '.git')))
    yield* shadow.run('recovery-discard', ['--git-dir', shadow.gitDir, 'worktree', 'remove', '--force', record.path]);
  yield* io(() => rm(file, { force: true }));
});

const mergesAt = (shadow: ShadowGit, treeRoot: string) => {
  const file = fileOf(shadow, treeRoot);
  const save = (record: Record) =>
    io(async () => {
      await mkdir(dirname(file), { recursive: true });
      const draft = `${file}.tmp`;
      await writeFile(draft, JSON.stringify(record));
      await rename(draft, file);
    });
  const clean = (record: Record) => discard(shadow, file, record);
  const publish = Effect.fnUntraced(function* (record: Record, commit: string) {
    const branch = yield* shadow.run('recovery-target', ['-C', treeRoot, 'symbolic-ref', '--short', 'HEAD']);
    if (branch !== record.branch) return yield* failed(`the served tree stands on ${branch}; restore ${record.branch} before publishing`);
    const current = yield* shadow.run('recovery-target', ['-C', treeRoot, 'rev-parse', 'HEAD']);
    for (const ancestor of [current, record.theirs]) {
      const included = yield* shadow.run('recovery-ancestry', ['--git-dir', shadow.gitDir, 'merge-base', ancestor, commit]);
      if (included !== ancestor)
        return yield* failed(`the recovery must include ${ancestor}; merge it in ${record.path}, then resolve_graph_conflict again`);
    }
    yield* save({ ...record, ready: commit });
    yield* shadow.run('recovery-publish', ['-C', treeRoot, 'merge', '--ff-only', '--no-edit', commit]);
    const published = { ...record, published: commit };
    yield* save(published);
    yield* clean(published);
  });
  const restore = Effect.fnUntraced(function* () {
    let record = yield* recordAt(file);
    if (record?.published !== null && record?.published !== undefined) {
      yield* clean(record);
      return;
    }
    if (record === null && existsSync(join(treeRoot, '.git')) && (yield* shadow.mergeInProgress(treeRoot))) {
      const branch = yield* shadow.run('recovery-branch', ['-C', treeRoot, 'symbolic-ref', '--short', 'HEAD']);
      const base = yield* shadow.run('recovery-base', ['-C', treeRoot, 'rev-parse', 'HEAD']);
      const theirs = yield* shadow.run('recovery-theirs', ['-C', treeRoot, 'rev-parse', 'MERGE_HEAD']);
      const messagePath = yield* shadow.run('recovery-message', ['-C', treeRoot, 'rev-parse', '--git-path', 'MERGE_MSG']);
      const message = yield* io(() => readFile(resolve(treeRoot, messagePath), 'utf8'));
      const id = crypto.randomUUID();
      record = {
        id,
        treeRoot,
        path: join(dirname(shadow.gitDir), 'recovery', id),
        branch,
        incoming: /^merge (.+)$/m.exec(message)?.[1] ?? theirs,
        base,
        theirs,
        createdAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        conflicts: yield* shadow.unmergedPaths(treeRoot),
        threadId: null,
        relocating: true,
        ready: null,
        published: null,
      };
      yield* save(record);
    }
    if (record === null) return;
    if (!record.relocating) {
      if (record.ready !== null) {
        const base = yield* shadow.run('recovery-published', [
          '--git-dir',
          shadow.gitDir,
          'merge-base',
          record.ready,
          `refs/heads/${record.branch}`,
        ]);
        if (base === record.ready) {
          const published = { ...record, published: record.ready };
          yield* save(published);
          yield* clean(published);
          return;
        }
      }
      if (record.conflicts === null) {
        yield* discard(shadow, file, record);
        return;
      }
      if (!existsSync(join(record.path, '.git'))) {
        yield* shadow.run('recovery-create', ['--git-dir', shadow.gitDir, 'worktree', 'add', '--detach', record.path, record.base]);
        const outcome = yield* shadow.merge(record.path, record.theirs, `merge ${record.incoming}`);
        if (outcome.merged === null) yield* save({ ...record, conflicts: outcome.conflicts });
        else yield* publish(record, outcome.merged);
      }
      return;
    }
    if (!existsSync(join(record.path, '.git'))) yield* shadow.moveWorktree(treeRoot, record.path);
    yield* shadow.run('recovery-repair', ['--git-dir', shadow.gitDir, 'worktree', 'repair', record.path]);
    yield* shadow.run('recovery-detach', ['-C', record.path, 'update-ref', '--no-deref', 'HEAD', record.base]);
    yield* shadow.attach(treeRoot, record.branch);
    yield* save({ ...record, relocating: false });
  });

  return {
    file,
    treeRoot,
    read: () => readAt(file),
    assign: Effect.fnUntraced(function* (threadId: string) {
      const record = yield* recordAt(file);
      if (record === null) return yield* failed('no graph merge awaits recovery');
      yield* save({ ...record, threadId });
    }),
    restore,
    merge: Effect.fnUntraced(function* (incoming: string, carried: string = incoming) {
      yield* restore();
      const pending = yield* readAt(file);
      if (pending !== null) return { merged: null, conflicts: pending.conflicts };
      const branch = yield* shadow.run('recovery-branch', ['-C', treeRoot, 'symbolic-ref', '--short', 'HEAD']);
      const base = yield* shadow.run('recovery-base', ['-C', treeRoot, 'rev-parse', 'HEAD']);
      const theirs = yield* shadow.run('recovery-theirs', ['--git-dir', shadow.gitDir, 'rev-parse', carried]);
      const id = crypto.randomUUID();
      const record: Record = {
        id,
        treeRoot,
        path: join(dirname(shadow.gitDir), 'recovery', id),
        branch,
        incoming,
        base,
        theirs,
        createdAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        conflicts: null,
        threadId: null,
        relocating: false,
        ready: null,
        published: null,
      };
      yield* save(record);
      const outcome = yield* Effect.gen(function* () {
        yield* shadow.run('recovery-create', ['--git-dir', shadow.gitDir, 'worktree', 'add', '--detach', record.path, base]);
        const outcome = yield* shadow.merge(record.path, theirs, `merge ${incoming}`);
        if (outcome.merged !== null) yield* publish(record, outcome.merged);
        return outcome;
      }).pipe(Effect.catch((failure) => Effect.andThen(discard(shadow, file, record), Effect.fail(failure))));
      if (outcome.merged === null) yield* save({ ...record, conflicts: outcome.conflicts });
      return outcome;
    }),
    finish: Effect.fnUntraced(function* (shape: TreeShape) {
      const record = yield* recordAt(file);
      if (record === null || record.conflicts === null) return yield* failed('no graph merge awaits recovery');
      const resolved = record.conflicts;
      const marker = yield* readMarker(join(record.path, FORMAT_FILE));
      if (marker.kind === 'unreadable' || marker.kind === 'unwritten') return yield* failed(`${FORMAT_FILE}: ${marker.reason}`);
      yield* validateTree(record.path, shape).pipe(
        Effect.mapError(
          (cause) =>
            new OwnGitFailed({
              op: 'graph-recovery',
              message: `the recovery tree is unreadable: ${cause.message}`,
              ran: false,
            }),
        ),
      );
      const commit = (yield* shadow.mergeInProgress(record.path))
        ? yield* shadow.concludeMerge(record.path)
        : yield* shadow.run('recovery-head', ['-C', record.path, 'rev-parse', 'HEAD']);
      yield* publish(record, commit);
      return { commit, resolved };
    }),
  };
};

export type TreeMerges = ReturnType<typeof mergesAt>;

export const TreeMerges = {
  at: mergesAt,
  readAt,
  standing: (shadow: ShadowGit, treeRoot: string): boolean => existsSync(fileOf(shadow, treeRoot)),
  mergingTrees: (shadow: ShadowGit) =>
    Effect.map(
      Effect.flatMap(records(shadow), (found) => Effect.forEach(found, (record) => canon(record.treeRoot))),
      (trees): ReadonlySet<string> => new Set(trees),
    ),
  retireGone: Effect.fnUntraced(function* (shadow: ShadowGit, repository: string, branches: readonly string[], twins: readonly string[]) {
    const kept = new Set(branches);
    const verdicts = new Map<string, boolean>();
    for (const record of yield* records(shadow)) {
      const targetKept = kept.has(record.branch);
      if (targetKept && (kept.has(record.incoming) || tracked(record.incoming) || record.relocating || record.threadId !== null)) continue;
      if (!(yield* shadow.belongsTo(record.treeRoot, repository))) continue;
      if (targetKept && twins.includes(record.incoming)) {
        const held = verdicts.get(record.incoming) ?? (yield* heldBy(shadow, record.incoming, kept));
        verdicts.set(record.incoming, held);
        if (!held) continue;
      }
      yield* discard(shadow, fileOf(shadow, record.treeRoot), record);
      yield* Effect.logInfo('a graph recovery was retired with the branch that left its repository', {
        tree: record.treeRoot,
        branch: record.branch,
        incoming: record.incoming,
      });
    }
  }),
};
