import { Effect, Result } from 'effect';
import type { Git } from './Git.js';
import type { TextAt } from './entries.js';
import { objectsAt } from './objects.js';
import { treePathsAt } from './treePaths.js';
import {
  GitAnswerInvalid,
  GitUnreadable,
  commandFor,
  insideRepository,
  OFFLINE_PROMPTS,
  run,
  runEnded,
  troubleOf,
  unreadableBy,
  type GitRefused,
} from './repository.js';

type FileAt = Result.Result<Uint8Array | null, GitUnreadable | GitAnswerInvalid>;
export type BlobAt = { readonly blob: string; readonly path: string };

type Asked = { readonly at: number; readonly path: string; readonly blob: string; readonly mode: string };
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const UNATTENDED: Readonly<Record<string, string>> = {
  ...OFFLINE_PROMPTS,
  GCM_INTERACTIVE: 'never',
  GIT_LFS_SKIP_SMUDGE: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
};
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();
const unreadable = (failure: GitUnreadable | GitRefused | GitAnswerInvalid): GitUnreadable | GitAnswerInvalid =>
  failure._tag === 'GitRefused' ? new GitUnreadable({ command: failure.command, reason: troubleOf(failure) }) : failure;

const attributesAt = Effect.fn('Git.attributes')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
  attributes: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, ReadonlyMap<string, string>>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const said = yield* run(git, dir, ['check-attr', '-z', '--stdin', ...attributes], undefined, paths.map((path) => `${path}\0`).join(''));
  const values = new Map<string, Map<string, string>>();
  const parts = said.split('\0');
  if (parts.at(-1) !== '' || parts.length !== paths.length * attributes.length * 3 + 1) {
    return yield* new GitUnreadable({ command: commandFor(dir, ['check-attr']), reason: 'git returned incomplete attribute records' });
  }
  for (let at = 0; at + 2 < parts.length; at += 3) {
    const path = parts[at] as string;
    const held = values.get(path) ?? new Map<string, string>();
    held.set(parts[at + 1] as string, parts[at + 2] as string);
    values.set(path, held);
  }
  return values;
});

const chunksOf = (paths: readonly string[]): readonly (readonly string[])[] => {
  const chunks: string[][] = [];
  let bytes = 24_000;
  for (const path of paths) {
    const size = encoder.encode(path).length + 1;
    if (bytes + size > 24_000) {
      chunks.push([]);
      bytes = 0;
    }
    chunks.at(-1)!.push(path);
    bytes += size;
  }
  return chunks;
};

const entriesAt = Effect.fn('Git.workingEntries')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  paths: readonly string[],
  files: FileAt[],
): Effect.fn.Return<readonly Asked[], never> {
  const listed = new Map<string, { blob: string; mode: string }>();
  const conflicted = new Set<string>();
  const indices = new Map<string, number[]>();
  for (const [at, path] of paths.entries()) {
    if (!`${revision}${path}`.includes('\0') && insideRepository(dir, path)) {
      const held = indices.get(path);
      if (held === undefined) indices.set(path, [at]);
      else held.push(at);
    }
  }
  if (revision !== '') {
    const entries = yield* treePathsAt(git, dir, revision, [...indices.keys()]);
    for (const [path, entry] of entries) {
      if (entry._tag === 'Failure') for (const at of indices.get(path)!) files[at] = Result.fail(entry.failure);
      else if (entry.success !== null) listed.set(path, entry.success);
    }
  }
  for (const chunk of revision === '' ? chunksOf([...indices.keys()]) : []) {
    const args = ['ls-files', '--stage', '-z', '--', ...chunk];
    const answer = yield* Effect.result(
      run(git, dir, args, undefined, undefined, { GIT_LITERAL_PATHSPECS: '1', GIT_NO_REPLACE_OBJECTS: '1' }),
    );
    if (answer._tag === 'Failure') {
      for (const path of chunk) for (const at of indices.get(path)!) files[at] = Result.fail(unreadable(answer.failure));
      continue;
    }
    if (answer.success !== '' && !answer.success.endsWith('\0')) {
      const failure = new GitUnreadable({ command: commandFor(dir, args), reason: 'git returned an unterminated index entry' });
      for (const path of chunk) for (const at of indices.get(path)!) files[at] = Result.fail(failure);
      continue;
    }
    for (const record of answer.success.split('\0')) {
      if (record === '') continue;
      const tab = record.indexOf('\t');
      const path = record.slice(tab + 1);
      const header = record.slice(0, tab).split(' ');
      const valid = tab > 0 && header.length === 3 && /^\d{6}$/.test(header[0]!) && OID.test(header[1]!) && /^[0-3]$/.test(header[2]!);
      if (!valid) {
        const failure = new GitUnreadable({ command: commandFor(dir, args), reason: 'git returned an invalid tree or index entry' });
        for (const asked of chunk) for (const at of indices.get(asked)!) files[at] = Result.fail(failure);
        break;
      }
      if (header[2] !== '0') conflicted.add(path);
      else if (header[0] !== '160000') listed.set(path, { mode: header[0]!, blob: header[1]! });
    }
  }
  const asked: Asked[] = [];
  for (const [at, path] of paths.entries()) {
    if (`${revision}${path}`.includes('\0') || !insideRepository(dir, path)) {
      files[at] = Result.fail(
        new GitUnreadable({ command: commandFor(dir, ['cat-file']), reason: `${revision}:${path} names no file inside the repository` }),
      );
    } else if (conflicted.has(path)) {
      files[at] = Result.fail(
        new GitUnreadable({ command: commandFor(dir, ['ls-files', '--stage']), reason: `${path} has no resolved index entry` }),
      );
    } else if (files[at]?._tag !== 'Failure') {
      const entry = listed.get(path);
      if (entry !== undefined) asked.push({ at, path, ...entry });
    }
  }
  return asked;
});

export type Conversions = { readonly converted: ReadonlySet<string>; readonly normalized: ReadonlySet<string> };

const NORMALIZING = new Set(['true', 'yes', 'on', '1', 'input']);

const active = (value: string | undefined) => value !== undefined && value !== 'unspecified' && value !== 'unset';

export const conversionsAt = Effect.fn('Git.workingConversions')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
): Effect.fn.Return<Conversions, GitUnreadable | GitRefused | GitAnswerInvalid> {
  if (paths.length === 0) return { converted: new Set<string>(), normalized: new Set<string>() };
  const [attributes, config] = yield* Effect.all(
    [
      attributesAt(git, dir, paths, ['text', 'eol', 'filter', 'working-tree-encoding', 'ident']),
      runEnded(git, dir, ['config', '--get', 'core.autocrlf'], undefined, [1]),
    ],
    { concurrency: 2 },
  );
  const autocrlf = config.stdout.trim().toLowerCase();
  const converted = new Set<string>();
  const normalized = new Set<string>();
  for (const path of paths) {
    const attrs = attributes.get(path);
    const text = attrs?.get('text') ?? 'unspecified';
    const eol = attrs?.get('eol') ?? 'unspecified';
    if (
      active(attrs?.get('filter')) ||
      active(attrs?.get('working-tree-encoding')) ||
      active(attrs?.get('ident')) ||
      (text !== 'unset' && (active(text) || active(eol) || ['true', 'yes', 'on', '1'].includes(autocrlf)))
    )
      converted.add(path);
    if (text === 'set' || text === 'auto') normalized.add(path);
    else if (text === 'unspecified' && (eol === 'lf' || eol === 'crlf' || NORMALIZING.has(autocrlf))) normalized.add(path);
  }
  return { converted, normalized };
});

const filteredAt = Effect.fn('Git.workingFiltered')(function* (
  git: Git['Service'],
  dir: string,
  one: Asked,
  capture: number | undefined,
): Effect.fn.Return<FileAt, never> {
  const args = one.mode === '120000' ? ['cat-file', 'blob', one.blob] : ['cat-file', '--filters', `--path=${one.path}`, one.blob];
  const ended = yield* Effect.result(runEnded(git, dir, args, capture, [], { stdoutBytes: true, env: UNATTENDED }));
  if (ended._tag === 'Failure') return Result.fail(unreadable(ended.failure));
  return ended.success.stdoutBytes === undefined
    ? Result.fail(new GitUnreadable({ command: commandFor(dir, args), reason: 'git answered text where bytes were requested' }))
    : Result.succeed(ended.success.stdoutBytes);
});

const filesOf = Effect.fn('Git.workingObjects')(function* (
  git: Git['Service'],
  dir: string,
  asked: readonly Asked[],
  files: FileAt[],
  capture: number | undefined,
  known?: Conversions,
): Effect.fn.Return<readonly FileAt[], never> {
  if (asked.length === 0) return files;
  const regular = asked.filter((one) => one.mode !== '120000');
  const conversion =
    known !== undefined
      ? Result.succeed(known.converted)
      : regular.length === 0
        ? Result.succeed(new Set<string>())
        : yield* Effect.result(
            Effect.map(
              conversionsAt(
                git,
                dir,
                regular.map((one) => one.path),
              ),
              (found) => found.converted,
            ),
          );
  const raw = asked.filter((one) => one.mode === '120000' || (conversion._tag === 'Success' && !conversion.success.has(one.path)));
  const filtered = asked.filter((one) => one.mode !== '120000' && conversion._tag === 'Success' && conversion.success.has(one.path));
  if (conversion._tag === 'Failure') {
    for (const one of regular) files[one.at] = Result.fail(unreadable(conversion.failure));
  }
  const oids = [...new Set(raw.map((one) => one.blob))];
  if (oids.length > 0) {
    const reads = yield* objectsAt(git, dir, oids, { capture, env: { ...UNATTENDED }, extendEnv: true });
    const byOid = new Map(oids.map((oid, at) => [oid, reads[at]!]));
    for (const one of raw) {
      const answer = byOid.get(one.blob)!;
      if (answer._tag === 'Failure') {
        if (answer.failure._tag === 'GitBatchUnsupported') filtered.push(one);
        else files[one.at] = Result.fail(unreadableBy(commandFor(dir, ['cat-file', '--batch']), answer.failure));
      } else if (answer.success === null) {
        files[one.at] = Result.fail(
          new GitUnreadable({
            command: commandFor(dir, ['cat-file', '--batch']),
            reason: `object ${one.blob} named by the tree is unavailable`,
          }),
        );
      } else if (answer.success.overflow) {
        files[one.at] = Result.fail(new GitAnswerInvalid({ command: commandFor(dir, ['cat-file', 'blob', one.blob]), capture: capture! }));
      } else files[one.at] = Result.succeed(answer.success.type === 'blob' ? answer.success.bytes : null);
    }
  }
  yield* Effect.forEach(
    filtered,
    (one) =>
      Effect.map(filteredAt(git, dir, one, capture), (read) => {
        files[one.at] = read;
      }),
    { concurrency: 2, discard: true },
  );
  return files;
});

export const workingFilesAt = Effect.fn('Git.workingFiles')(function* (
  git: Git['Service'],
  dir: string,
  commit: string,
  paths: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly FileAt[], never> {
  const files: FileAt[] = paths.map(() => Result.succeed(null));
  const asked = yield* entriesAt(git, dir, commit, paths, files);
  return yield* filesOf(git, dir, asked, files, options.capture);
});

const textsOfFiles = (files: readonly FileAt[]): readonly TextAt[] =>
  files.map((file) => (file._tag === 'Failure' || file.success === null ? (file as TextAt) : Result.succeed(utf8.decode(file.success))));

export const workingBlobFilesAt = Effect.fn('Git.workingBlobFiles')(function* (
  git: Git['Service'],
  dir: string,
  blobs: readonly BlobAt[],
  options: { readonly capture?: number; readonly conversions?: Conversions } = {},
): Effect.fn.Return<readonly FileAt[], never> {
  const files: FileAt[] = blobs.map(() => Result.succeed(null));
  const asked: Asked[] = [];
  for (const [at, { blob, path }] of blobs.entries()) {
    if (!OID.test(blob) || path.includes('\0') || !insideRepository(dir, path)) {
      files[at] = Result.fail(
        new GitUnreadable({ command: commandFor(dir, ['cat-file']), reason: `${blob}:${path} names no blob this reader can frame` }),
      );
    } else asked.push({ at, blob, path, mode: '100644' });
  }
  return yield* filesOf(git, dir, asked, files, options.capture, options.conversions);
});

export const workingBlobTextsAt = Effect.fn('Git.workingBlobTexts')(function* (
  git: Git['Service'],
  dir: string,
  blobs: readonly BlobAt[],
  options: { readonly capture?: number; readonly conversions?: Conversions } = {},
): Effect.fn.Return<readonly TextAt[], never> {
  return textsOfFiles(yield* workingBlobFilesAt(git, dir, blobs, options));
});

export const workingTextsAt = Effect.fn('Git.workingTexts')(function* (
  git: Git['Service'],
  dir: string,
  commit: string,
  paths: readonly string[],
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly TextAt[], never> {
  return textsOfFiles(yield* workingFilesAt(git, dir, commit, paths, options));
});

export const stagedTextsAt = Effect.fn('Git.stagedTexts')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
  _scratch: string,
  options: { readonly capture?: number } = {},
): Effect.fn.Return<readonly TextAt[], never> {
  return yield* workingTextsAt(git, dir, '', paths, options);
});

export const normalizedAt = Effect.fn('Git.normalized')(function* (
  git: Git['Service'],
  dir: string,
  paths: readonly string[],
): Effect.fn.Return<ReadonlySet<string>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  return (yield* conversionsAt(git, dir, paths)).normalized;
});
