import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { Git } from '@runlith/git/Git';
import { gitRefusal, gitText } from '../../platform/git/readings.js';
import { type Refused, fsAct, refuse } from '../entries/record.js';

export const TrashEntry = Schema.Struct({ path: Schema.String, kind: Schema.Literals(['file', 'directory', 'link']) });

export const TrashFile = Schema.Struct({ path: Schema.String, digest: Schema.String });

export const Manifest = Schema.Struct({
  at: Schema.Number,
  entries: Schema.Array(TrashEntry),
  files: Schema.Array(TrashFile),
});
export type Manifest = typeof Manifest.Type;

const MANIFEST = 'manifest.json';

const ENTRIES = 'entries';

export const ID = /^[0-9a-z]+-[0-9a-f]{8}$/u;

export const trashIn = (gitDir: string): string => join(gitDir, 'tagma', 'trash');

export const entriesIn = (home: string): string => join(home, ENTRIES);

export const freshId = (): string => `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

const GIT_DIRS_KEPT = 1024;

export const makeGitDirs = Effect.fnUntraced(function* () {
  const git = yield* Git;
  const known = new Map<string, string>();

  return {
    of: (root: string): Effect.Effect<string, Refused> =>
      Effect.suspend(() => {
        const standing = known.get(root);
        if (standing !== undefined) return Effect.succeed(standing);
        return Effect.flatMap(Effect.mapError(gitText(git, root, ['rev-parse', '--absolute-git-dir']), gitRefusal), (said) => {
          if (said === null) return Effect.fail(refuse('git-refused', `${root} is not inside a git repository`, 'act in a git checkout'));
          if (known.size >= GIT_DIRS_KEPT) known.clear();
          known.set(root, said.trim());
          return Effect.succeed(said.trim());
        });
      }),
  };
});

export type GitDirs = Effect.Success<ReturnType<typeof makeGitDirs>>;

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));

export type Kept =
  | { readonly kind: 'kept'; readonly manifest: Manifest }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string };

export const manifestAt = Effect.fnUntraced(function* (home: string) {
  const read = yield* Effect.result(Effect.tryPromise({ try: () => readFile(join(home, MANIFEST), 'utf8'), catch: (cause) => cause }));
  if (read._tag === 'Failure') {
    return (codeOf(read.failure) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', reason: String(read.failure) }) as Kept;
  }
  const decoded = yield* Effect.result(decode(read.success));
  if (decoded._tag === 'Failure') {
    yield* Effect.logWarning('a trash manifest could not be read; its act is judged by its directory time', {
      home,
      reason: decoded.failure.message,
    });
    return { kind: 'unreadable', reason: decoded.failure.message } as Kept;
  }
  return { kind: 'kept', manifest: decoded.success } as Kept;
});

export const keepManifest = (home: string, manifest: Manifest): Effect.Effect<void, Refused> =>
  fsAct(home, async () => {
    await mkdir(entriesIn(home), { recursive: true });
    await writeFile(join(home, MANIFEST), JSON.stringify(manifest), { flag: 'wx' });
  });

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

export type Relocated = { readonly left: string | null };

const copied = async (from: string, to: string): Promise<void> => {
  const staged = join(dirname(to), `.${basename(to)}.${crypto.randomUUID()}.tagma`);
  try {
    await cp(from, staged, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true });
    await rename(staged, to);
  } catch (cause) {
    await rm(staged, { recursive: true, force: true });
    throw cause;
  }
};

export const relocated = (from: string, to: string): Effect.Effect<Relocated, Refused> =>
  fsAct(from, async (): Promise<Relocated> => {
    try {
      await rename(from, to);
      return { left: null };
    } catch (cause) {
      if (codeOf(cause) !== 'EXDEV') throw cause;
    }
    await copied(from, to);
    try {
      await rm(from, { recursive: true, force: true });
      return { left: null };
    } catch {
      return { left: from };
    }
  });

export const dropped = (home: string): Effect.Effect<void, Refused> => fsAct(home, () => rm(home, { recursive: true, force: true }));

export const makeTrashActs = () => {
  const held = new Set<string>();

  return {
    holding: <A, E, R>(home: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.sync(() => held.add(home)),
        () => work,
        () => Effect.sync(() => void held.delete(home)),
      ),

    busy: (home: string): boolean => held.has(home),
  };
};

export type TrashActs = ReturnType<typeof makeTrashActs>;

export const gone = (id: string): Refused =>
  refuse('source-moved', `the trash holds no act ${id}: it was restored or emptied`, 'nothing is left to restore under this id');
