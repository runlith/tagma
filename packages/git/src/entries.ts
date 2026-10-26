import { Effect, Result } from 'effect';
import type { Git } from './Git.js';
import {
  run,
  runBytes,
  runEnded,
  commandFor,
  commitOf,
  GitUnreadable,
  insideRepository,
  literal,
  troubleOf,
  type GitAnswerInvalid,
  type GitRefused,
} from './repository.js';

const PATH_BATCH = 200;

const RETRY_AT_ONCE = 4;

const SAID_CAP = 200;

function inBatches(paths: readonly string[]): readonly (readonly string[])[] {
  const batches: string[][] = [];
  for (let at = 0; at < paths.length; at += PATH_BATCH) batches.push([...paths.slice(at, at + PATH_BATCH)]);
  return batches;
}

const saidBy = (failure: GitUnreadable | GitRefused | GitAnswerInvalid): string => {
  const whole = troubleOf(failure);
  const end = whole.indexOf('\n');
  const first = end === -1 ? whole : whole.slice(0, end);
  return first.length > SAID_CAP ? `${first.slice(0, SAID_CAP)}…` : first;
};

export type Unread = { readonly unread: ReadonlyMap<string, string> };

type Answered = { readonly batch: readonly string[]; readonly text: string };

const readPaths = Effect.fn('Git.readPaths')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
  argv: (batch: readonly string[]) => readonly string[],
  capture: number | undefined,
): Effect.fn.Return<{ readonly answered: readonly Answered[]; readonly unread: ReadonlyMap<string, string> }, never> {
  const unread = new Map<string, string>();
  const answered: Answered[] = [];
  const askable = paths.filter((path) => {
    if (insideRepository(dir, path)) return true;
    unread.set(path, `${path} is outside the repository at ${dir}`);
    return false;
  });
  const ask = (batch: readonly string[]) =>
    Effect.map(Effect.result(run(git, dir, argv(batch), capture)), (answer) => ({ batch, answer }) as const);
  const alone = Effect.fnUntraced(function* (paths: readonly string[]) {
    const tried = yield* Effect.forEach(paths, (path) => ask([path]), { concurrency: RETRY_AT_ONCE });
    for (const { batch, answer } of tried) {
      if (answer._tag === 'Success') answered.push({ batch, text: answer.success });
      else unread.set(batch[0] as string, saidBy(answer.failure));
    }
  });
  const split: (batch: readonly string[]) => Effect.Effect<void> = Effect.fnUntraced(function* (batch: readonly string[]) {
    const middle = Math.ceil(batch.length / 2);
    const tried = yield* Effect.forEach([batch.slice(0, middle), batch.slice(middle)], ask, { concurrency: 2 });
    const failed = tried.filter((one) => one.answer._tag === 'Failure');
    for (const one of tried) {
      if (one.answer._tag === 'Success') answered.push({ batch: one.batch, text: one.answer.success });
      else if (one.batch.length === 1) unread.set(one.batch[0] as string, saidBy(one.answer.failure));
    }
    const wider = failed.filter((one) => one.batch.length > 1).map((one) => one.batch);
    if (failed.length === tried.length) yield* alone(wider.flat());
    else for (const half of wider) yield* split(half);
  });
  const batches = yield* Effect.forEach(inBatches(askable), ask);
  for (const { batch, answer } of batches) {
    if (answer._tag === 'Success') answered.push({ batch, text: answer.success });
    else if (batch.length === 1) unread.set(batch[0] as string, saidBy(answer.failure));
    else yield* split(batch);
  }
  return { answered, unread };
});

export type TreeEntry = {
  readonly mode: string;
  readonly object: string;
};

export type TreeEntries = Unread & {
  readonly entries: ReadonlyMap<string, TreeEntry>;
};

export const treeEntriesAt = Effect.fn('Git.treeEntries')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  paths: readonly string[] | null,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<TreeEntries, never> {
  const entries = new Map<string, TreeEntry>();
  const read =
    paths === null
      ? yield* Effect.map(Effect.result(run(git, dir, ['ls-tree', '-r', '-z', '--end-of-options', revision], options.capture)), (answer) =>
          answer._tag === 'Success'
            ? { answered: [{ batch: [], text: answer.success }], unread: new Map<string, string>() }
            : { answered: [], unread: new Map([['', saidBy(answer.failure)]]) },
        )
      : yield* readPaths(
          git,
          dir,
          paths,
          (batch) => ['ls-tree', '-r', '-z', '--end-of-options', revision, '--', ...batch.map(literal)],
          options.capture,
        );
  for (const { text } of read.answered) {
    for (const record of text.split('\0')) {
      const tab = record.indexOf('\t');
      if (tab === -1) continue;
      const [mode = '', , object = ''] = record.slice(0, tab).split(' ');
      if (!/^\d{6}$/.test(mode) || object === '') continue;
      entries.set(record.slice(tab + 1), { mode, object });
    }
  }
  return { entries, unread: read.unread };
});

export const stagedEntriesAt = Effect.fn('Git.stagedEntries')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<TreeEntries, never> {
  const entries = new Map<string, TreeEntry>();
  const read = yield* readPaths(git, dir, paths, (batch) => ['ls-files', '--stage', '-z', '--', ...batch.map(literal)], options.capture);
  const unread = new Map(read.unread);
  for (const { batch, text } of read.answered) {
    for (const record of text.split('\0')) {
      if (record === '') continue;
      const tab = record.indexOf('\t');
      if (tab === -1) {
        for (const path of batch) unread.set(path, 'git ls-files returned an entry without its path');
        continue;
      }
      const path = record.slice(tab + 1);
      const [mode = '', object = '', stage = ''] = record.slice(0, tab).split(' ');
      if (!/^\d{6}$/.test(mode) || object === '' || stage !== '0') {
        unread.set(path, stage === '0' ? 'git ls-files returned an invalid entry' : 'the index holds unresolved stages');
        entries.delete(path);
      } else if (!unread.has(path)) entries.set(path, { mode, object });
    }
  }
  return { entries, unread };
});

const outsideReading = (dir: string, path: string, args: readonly string[]): GitUnreadable =>
  new GitUnreadable({ command: commandFor(dir, args), reason: `${path} is outside the repository at ${dir}` });

export const blobAt = Effect.fn('Git.blob')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  path: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitAnswerInvalid> {
  const args = ['show', '--end-of-options', `${revision}:${path}`];
  if (!insideRepository(dir, path)) return yield* outsideReading(dir, path, args);
  return yield* run(git, dir, args, options.capture).pipe(Effect.catchTag('GitRefused', () => Effect.succeed(null)));
});

export const fileAt = Effect.fn('Git.file')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  path: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitAnswerInvalid> {
  const args = ['cat-file', 'blob', '--end-of-options', `${revision}:${path}`];
  if (!insideRepository(dir, path)) return yield* outsideReading(dir, path, args);
  return yield* run(git, dir, args, options.capture).pipe(Effect.catchTag('GitRefused', () => Effect.succeed(null)));
});

export const stagedBlobAt = Effect.fn('Git.stagedBlob')(function* (
  git: Git['Service'],
  dir: string,
  path: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<string | null, GitUnreadable | GitAnswerInvalid> {
  const args = ['show', '--end-of-options', `:${path}`];
  if (!insideRepository(dir, path)) return yield* outsideReading(dir, path, args);
  return yield* run(git, dir, args, options.capture).pipe(Effect.catchTag('GitRefused', () => Effect.succeed(null)));
});

export const blobBytesAt = Effect.fn('Git.blobBytes')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  path: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<Uint8Array | null, GitUnreadable | GitAnswerInvalid> {
  const args = ['cat-file', 'blob', '--end-of-options', `${revision}:${path}`];
  if (!insideRepository(dir, path)) return yield* outsideReading(dir, path, args);
  const ended = yield* runEnded(git, dir, args, options.capture, [], { stdoutBytes: true }).pipe(
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  if (ended === null) return null;
  if (ended.stdoutBytes === undefined) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'the git road answered text where bytes were asked' });
  }
  return ended.stdoutBytes;
});

export const blobPrefixAt = Effect.fn('Git.blobPrefix')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  path: string,
  bytes: number,
): Effect.fn.Return<Uint8Array | null, GitUnreadable | GitAnswerInvalid> {
  const args = ['cat-file', 'blob', '--end-of-options', `${revision}:${path}`];
  if (!insideRepository(dir, path)) return yield* outsideReading(dir, path, args);
  const ended = yield* runEnded(git, dir, args, bytes, [], { stdoutBytes: true, prefix: true }).pipe(
    Effect.catchTag('GitRefused', () => Effect.succeed(null)),
  );
  if (ended === null) return null;
  if (ended.stdoutBytes === undefined) {
    return yield* new GitUnreadable({ command: commandFor(dir, args), reason: 'the git road answered text where bytes were asked' });
  }
  return ended.stdoutBytes;
});

export type BlobInput = { readonly tree: string; readonly path: string };

export type ObjectInput = { readonly object: string };

export type BlobAnswer =
  | { readonly status: 'text'; readonly object: string; readonly text: string }
  | { readonly status: 'absent' }
  | { readonly status: 'unread'; readonly reason: string };

const BLOB_HEADER = /^([0-9a-f]{40,64}) ([a-z]+) (\d+)$/;

const OBJECT_NAME = /^[0-9a-f]{40,64}$/;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenient = new TextDecoder('utf-8');

const textOf = (bytes: Uint8Array): string | null => {
  try {
    return utf8.decode(bytes);
  } catch {
    return null;
  }
};

export const blobsAt = Effect.fn('Git.blobs')(function* (
  git: Git['Service'],
  dir: string,
  asked: readonly (BlobInput | ObjectInput)[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly BlobAnswer[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const reads: (BlobAnswer | undefined)[] = asked.map((one) => {
    if ('object' in one) return OBJECT_NAME.test(one.object) ? undefined : { status: 'unread', reason: `${one.object} names no object` };
    if (`${one.tree}${one.path}`.includes('\0')) return { status: 'unread', reason: `${one.tree}:${one.path} holds a NUL` };
    if (!insideRepository(dir, one.path)) return { status: 'unread', reason: `${one.path} is outside the repository at ${dir}` };
    return undefined;
  });
  const sent = asked.flatMap((one, at) =>
    reads[at] === undefined ? [{ at, name: 'object' in one ? one.object : `${one.tree}:${one.path}` }] : [],
  );
  if (sent.length === 0) return reads as readonly BlobAnswer[];
  const args = ['cat-file', '--batch', '-Z'];
  const bytes = yield* runBytes(git, dir, args, options.capture, sent.map(({ name }) => `${name}\0`).join(''));
  const unframed = (reason: string) => new GitUnreadable({ command: commandFor(dir, args), reason });
  let cursor = 0;
  for (const { at, name } of sent) {
    const end = bytes.indexOf(0, cursor);
    if (end === -1) return yield* unframed(`cat-file answered no header for ${name}`);
    const header = lenient.decode(bytes.subarray(cursor, end));
    cursor = end + 1;
    const found = BLOB_HEADER.exec(header);
    if (found === null) {
      if (header === `${name} missing`) reads[at] = { status: 'absent' };
      else if (header.startsWith(`${name} `)) reads[at] = { status: 'unread', reason: header };
      else return yield* unframed(`cat-file answered a header this reader cannot frame for ${name}`);
      continue;
    }
    const [, object = '', kind = '', size = ''] = found;
    const close = cursor + Number(size);
    if (bytes[close] !== 0) return yield* unframed(`cat-file answered a body shorter than ${size} bytes for ${name}`);
    const body = bytes.subarray(cursor, close);
    cursor = close + 1;
    if (kind !== 'blob') {
      reads[at] = { status: 'absent' };
      continue;
    }
    const text = textOf(body);
    reads[at] = text === null ? { status: 'unread', reason: `${name} is not UTF-8 text` } : { status: 'text', object, text };
  }
  return reads as readonly BlobAnswer[];
});

export type TextAt = Result.Result<string | null, GitUnreadable | GitAnswerInvalid>;

const sizesAt = Effect.fn('Git.sizes')(function* (
  git: Git['Service'],
  dir: string,
  asked: readonly BlobInput[],
): Effect.fn.Return<readonly (number | null | undefined)[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const sizes: (number | null | undefined)[] = asked.map(() => undefined);
  const sent = asked.flatMap(({ tree, path }, at) =>
    `${tree}${path}`.includes('\0') || !insideRepository(dir, path) ? [] : [{ at, name: `${tree}:${path}` }],
  );
  if (sent.length === 0) return sizes;
  const listing = yield* run(git, dir, ['cat-file', '--batch-check', '-Z'], undefined, sent.map(({ name }) => `${name}\0`).join(''));
  const records = listing.split('\0');
  for (const [index, { at, name }] of sent.entries()) {
    const record = records[index] ?? '';
    const found = BLOB_HEADER.exec(record);
    if (found !== null) sizes[at] = found[2] === 'blob' ? Number(found[3]) : null;
    else if (record === `${name} missing`) sizes[at] = null;
  }
  return sizes;
});

const SESSION_BYTES = 16_000_000;

const sessionsOf = (batched: readonly number[], sizes: readonly (number | null | undefined)[]): readonly (readonly number[])[] => {
  const sessions: number[][] = [];
  let bytes = SESSION_BYTES;
  for (const at of batched) {
    const size = sizes[at] ?? 0;
    if (sessions.length === 0 || bytes + size > SESSION_BYTES) {
      sessions.push([]);
      bytes = 0;
    }
    (sessions[sessions.length - 1] as number[]).push(at);
    bytes += size;
  }
  return sessions;
};

export const textsAt = Effect.fn('Git.texts')(function* (
  git: Git['Service'],
  dir: string,
  asked: readonly BlobInput[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly TextAt[], never> {
  const texts: (TextAt | undefined)[] = asked.map(() => undefined);
  const alone: number[] = [];
  let batched = asked.map((_, at) => at);
  let sizes: readonly (number | null | undefined)[] = [];
  if (options.capture !== undefined && asked.length > 0) {
    const capture = options.capture;
    const sized = yield* Effect.result(sizesAt(git, dir, asked));
    sizes = sized._tag === 'Success' ? sized.success : [];
    batched = [];
    for (const at of asked.keys()) {
      const size = sizes[at];
      if (size === null) texts[at] = Result.succeed(null);
      else if (size === undefined || size > capture) alone.push(at);
      else batched.push(at);
    }
  }
  for (const session of sessionsOf(batched, sizes)) {
    const read = yield* Effect.result(
      blobsAt(
        git,
        dir,
        session.map((at) => asked[at] as BlobInput),
      ),
    );
    for (const [index, at] of session.entries()) {
      const one = read._tag === 'Success' ? read.success[index] : undefined;
      const fits = one?.status !== 'text' || options.capture === undefined || Buffer.byteLength(one.text) <= options.capture;
      if (one?.status === 'text' && fits) texts[at] = Result.succeed(one.text);
      else if (one?.status === 'absent') texts[at] = Result.succeed(null);
      else alone.push(at);
    }
  }
  yield* Effect.forEach(
    alone,
    (at) => {
      const { tree, path } = asked[at] as BlobInput;
      return Effect.map(Effect.result(blobAt(git, dir, tree, path, options)), (answer) => void (texts[at] = answer));
    },
    { concurrency: RETRY_AT_ONCE, discard: true },
  );
  return texts as readonly TextAt[];
});

export const ignoredAmong = Effect.fn('Git.ignoredAmong')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<ReadonlySet<string>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  if (paths.length === 0) return new Set<string>();
  const listed = yield* run(git, dir, ['check-ignore', '-z', '--stdin'], options.capture, paths.map((path) => `${path}\0`).join('')).pipe(
    Effect.catchTag('GitRefused', (failure) => (failure.status === 1 ? Effect.succeed('') : Effect.fail(failure))),
  );
  return new Set(listed.split('\0').filter((name) => name !== ''));
});

export const ignoredPaths = Effect.fn('Git.ignoredPaths')(function* (
  git: Git['Service'],
  dir: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const listing = yield* run(git, dir, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'], options.capture);
  return listing.split('\0').filter((name) => name !== '');
});

export const filesUnder = Effect.fn('Git.filesUnder')(function* (
  git: Git['Service'],
  dir: string,
  place: string | readonly string[],
  options: { readonly others?: boolean; readonly capture?: number } = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const places = typeof place === 'string' ? [place] : place;
  const listing = yield* run(
    git,
    dir,
    [
      'ls-files',
      '-z',
      '--cached',
      ...(options.others === true ? ['--others', '--exclude-standard'] : []),
      '--',
      ...places.map((one) => literal(one === '' ? '.' : one)),
    ],
    options.capture,
  );
  return [...new Set(listing.split('\0').filter((name) => name !== ''))];
});

export const changedBetween = Effect.fn('Git.changedBetween')(function* (
  git: Git['Service'],
  dir: string,
  from: string,
  to: string,
  options: { readonly capture?: number; readonly sinceFork?: boolean } = {},
): Effect.fn.Return<readonly string[], GitUnreadable | GitRefused | GitAnswerInvalid> {
  const listing = yield* run(
    git,
    dir,
    ['diff', '--no-renames', '--name-only', '-z', '--end-of-options', `${from}${options.sinceFork === true ? '...' : '..'}${to}`],
    options.capture,
  );
  return [...new Set(listing.split('\0').filter((name) => name !== ''))];
});

export const parentOf = (
  git: Git['Service'],
  dir: string,
  commit: string,
  options: { readonly capture?: number } = {},
): Effect.Effect<string | null, GitUnreadable | GitRefused | GitAnswerInvalid> => commitOf(git, dir, `${commit}^`, options);
