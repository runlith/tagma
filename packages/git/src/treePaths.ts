import { posix } from 'node:path';
import { Effect, Result } from 'effect';
import type { Git, GitObject, GitObjectAt } from './Git.js';
import { objectsAt } from './objects.js';
import { commandFor, GitAnswerInvalid, type GitRefused, GitUnreadable, run, troubleOf, unreadableBy } from './repository.js';

type Trie = { readonly children: Map<string, Trie>; readonly paths: string[] };
export type TreeFile = { readonly blob: string; readonly mode: string };
export type TreePathAt = Result.Result<TreeFile | null, GitUnreadable | GitAnswerInvalid>;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const utf8 = new TextDecoder();
const literalObjects = { GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' };
const branch = (): Trie => ({ children: new Map(), paths: [] });

const objectOf = (dir: string, answer: GitObjectAt): Result.Result<GitObject, GitUnreadable> => {
  if (answer._tag === 'Failure')
    return Result.fail(
      answer.failure._tag === 'GitBatchUnsupported'
        ? new GitUnreadable({ command: answer.failure.command, reason: answer.failure.reason })
        : unreadableBy(commandFor(dir, ['cat-file', '--batch']), answer.failure),
    );
  if (answer.success === null)
    return Result.fail(
      new GitUnreadable({ command: commandFor(dir, ['cat-file', '--batch']), reason: 'a referenced tree object is unavailable' }),
    );
  return Result.succeed(answer.success);
};

const rootAt = Effect.fn('Git.rootTree')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
): Effect.fn.Return<string, GitUnreadable | GitAnswerInvalid> {
  if (!OID.test(revision)) {
    const oid = yield* run(
      git,
      dir,
      ['rev-parse', '--verify', '--end-of-options', `${revision}^{tree}`],
      undefined,
      undefined,
      literalObjects,
    ).pipe(
      Effect.mapError((failure) =>
        failure._tag === 'GitRefused' ? new GitUnreadable({ command: failure.command, reason: troubleOf(failure) }) : failure,
      ),
    );
    const named = oid.trim();
    if (OID.test(named)) return named;
    return yield* new GitUnreadable({ command: commandFor(dir, ['rev-parse']), reason: 'git returned an invalid root tree id' });
  }
  let oid = revision;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(oid))
      return yield* new GitUnreadable({ command: commandFor(dir, ['cat-file']), reason: 'an annotated tag points in a cycle' });
    seen.add(oid);
    const answer = (yield* objectsAt(git, dir, [oid], { env: literalObjects, extendEnv: true }))[0]!;
    const reading = objectOf(dir, answer);
    if (reading._tag === 'Failure') return yield* reading.failure;
    const object = reading.success;
    if (object.type === 'tree') return oid;
    const end = object.bytes.indexOf(10);
    const line = utf8.decode(object.bytes.subarray(0, end));
    const prefix = object.type === 'commit' ? 'tree ' : object.type === 'tag' ? 'object ' : '';
    const next = line.slice(prefix.length);
    if (prefix === '' || end < 0 || !line.startsWith(prefix) || !OID.test(next)) {
      return yield* new GitUnreadable({ command: commandFor(dir, ['cat-file']), reason: `${revision} does not name a readable tree` });
    }
    if (object.type === 'commit') return next;
    oid = next;
  }
});

type Directory = { readonly oid: string; readonly trie: Trie };

const failedBelow = (trie: Trie, failure: GitUnreadable, found: Map<string, TreePathAt>): void => {
  const pending = [trie];
  for (let at = 0; at < pending.length; at += 1) {
    const one = pending[at]!;
    for (const path of one.paths) found.set(path, Result.fail(failure));
    for (const child of one.children.values()) pending.push(child);
  }
};

const descend = (dir: string, tree: Directory, object: GitObject, found: Map<string, TreePathAt>, next: Directory[]): void => {
  const bytes = object.bytes;
  const width = tree.oid.length / 2;
  let offset = 0;
  let left = tree.trie.children.size;
  const fail = () =>
    failedBelow(
      tree.trie,
      new GitUnreadable({ command: commandFor(dir, ['cat-file']), reason: `tree ${tree.oid} has invalid entry framing` }),
      found,
    );
  if (object.type !== 'tree' || object.overflow) {
    fail();
    return;
  }
  while (offset < bytes.length && left > 0) {
    const space = bytes.indexOf(32, offset);
    const zero = bytes.indexOf(0, space + 1);
    if (space < offset || zero < space || zero + width >= bytes.length) {
      fail();
      return;
    }
    const mode = utf8.decode(bytes.subarray(offset, space));
    if (!/^(40000|100644|100755|120000|160000)$/.test(mode)) {
      fail();
      return;
    }
    const name = utf8.decode(bytes.subarray(space + 1, zero));
    const child = tree.trie.children.get(name);
    if (child !== undefined) {
      left -= 1;
      const oid = Buffer.from(bytes.subarray(zero + 1, zero + width + 1)).toString('hex');
      if (mode === '40000') {
        if (child.children.size > 0) next.push({ oid, trie: child });
      } else if (mode !== '160000') {
        for (const path of child.paths) found.set(path, Result.succeed({ blob: oid, mode }));
      }
    }
    offset = zero + width + 1;
  }
};

export type TreeBlob = TreeFile & { readonly bytes: Uint8Array; readonly overflow: boolean };

export const treeBlobAt = Effect.fn('Git.treeBlob')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  path: string,
  capture?: number,
): Effect.fn.Return<TreeBlob | null, GitUnreadable | GitAnswerInvalid> {
  const found = (yield* treeBlobsAt(git, dir, revision, [path], capture)).get(path);
  if (found === undefined) return yield* unreadable(dir, `${path} was not looked up`);
  if (found._tag === 'Failure') return yield* found.failure;
  return found.success;
});

export type TreeBlobAt = Result.Result<TreeBlob | null, GitUnreadable | GitAnswerInvalid>;

export const treeBlobsAt = Effect.fn('Git.treeBlobs')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  paths: readonly string[],
  capture?: number,
): Effect.fn.Return<ReadonlyMap<string, TreeBlobAt>, never> {
  const files = yield* treePathsAt(git, dir, revision, paths);
  const blobs = [
    ...new Set([...files.values()].flatMap((one) => (one._tag === 'Success' && one.success !== null ? [one.success.blob] : []))),
  ];
  const answers = yield* objectsAt(git, dir, blobs, { env: literalObjects, extendEnv: true, capture });
  const read = new Map(blobs.map((blob, at) => [blob, objectOf(dir, answers[at]!)]));
  return new Map(
    [...files].map(([path, file]): [string, TreeBlobAt] => {
      if (file._tag === 'Failure') return [path, Result.fail(file.failure)];
      if (file.success === null) return [path, Result.succeed(null)];
      const reading = read.get(file.success.blob)!;
      if (reading._tag === 'Failure') return [path, Result.fail(reading.failure)];
      if (reading.success.type !== 'blob')
        return [path, Result.fail(unreadable(dir, `${path} names a ${reading.success.type}, not a blob`))];
      return [path, Result.succeed({ ...file.success, bytes: reading.success.bytes, overflow: reading.success.overflow })];
    }),
  );
});

const unreadable = (dir: string, reason: string): GitUnreadable =>
  new GitUnreadable({ command: commandFor(dir, ['cat-file', '--batch']), reason });

export const treePathsAt = Effect.fn('Git.treePaths')(function* (
  git: Git['Service'],
  dir: string,
  revision: string,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, TreePathAt>, never> {
  const found = new Map<string, TreePathAt>(paths.map((path) => [path, Result.succeed(null)]));
  if (paths.length === 0) return found;
  const root = branch();
  for (const path of paths) {
    let at = root;
    for (const part of posix.normalize(path).split('/')) {
      let child = at.children.get(part);
      if (child === undefined) {
        child = branch();
        at.children.set(part, child);
      }
      at = child;
    }
    at.paths.push(path);
  }
  const rootOid = yield* Effect.result(rootAt(git, dir, revision));
  if (rootOid._tag === 'Failure') return new Map(paths.map((path) => [path, Result.fail(rootOid.failure)]));
  let level: Directory[] = [{ oid: rootOid.success, trie: root }];
  while (level.length > 0) {
    const oids = [...new Set(level.map((tree) => tree.oid))];
    const objects = yield* objectsAt(git, dir, oids, { env: literalObjects, extendEnv: true });
    const reads = new Map(oids.map((oid, at) => [oid, objectOf(dir, objects[at]!)]));
    const next: Directory[] = [];
    for (const tree of level) {
      const reading = reads.get(tree.oid)!;
      if (reading._tag === 'Failure') failedBelow(tree.trie, reading.failure, found);
      else descend(dir, tree, reading.success, found, next);
    }
    level = next;
  }
  return found;
});

export const carryingAt = Effect.fn('Git.carrying')(function* (
  git: Git['Service'],
  dir: string,
  commits: readonly string[],
  path: string,
): Effect.fn.Return<ReadonlySet<string>, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const args = ['cat-file', '--batch-check=%(objectname) %(objecttype)'];
  if (commits.length === 0) return new Set();
  if (/[\n\0]/.test(path) || commits.some((commit) => !OID.test(commit)))
    return yield* new GitUnreadable({
      command: commandFor(dir, args),
      reason: 'a commit is not a full object id or the path is not one line',
    });
  const checked = Effect.fnUntraced(function* (names: readonly string[]) {
    if (names.length === 0) return [];
    const lines = (yield* run(git, dir, args, undefined, names.map((name) => `${name}\n`).join(''), literalObjects)).split('\n');
    if (lines.pop() !== '' || lines.length !== names.length)
      return yield* new GitUnreadable({
        command: commandFor(dir, args),
        reason: 'cat-file answered another number of lines than it was asked',
      });
    return lines;
  });
  const entries = yield* checked(commits.map((commit) => `${commit}:${path}`));
  const carrying = new Set(commits.filter((commit, at) => entries[at] !== `${commit}:${path} missing`));
  const unsure = commits.filter((commit) => !carrying.has(commit));
  const roots = yield* checked(unsure.map((commit) => `${commit}^{tree}`));
  const trie = branch();
  let leaf = trie;
  for (const part of posix.normalize(path).split('/')) {
    const child = branch();
    leaf.children.set(part, child);
    leaf = child;
  }
  leaf.paths.push(path);
  const found = new Map(unsure.map((commit) => [commit, new Map<string, TreePathAt>()]));
  let level: { readonly commit: string; readonly tree: Directory }[] = [];
  for (const [at, commit] of unsure.entries()) {
    const [oid = '', type] = roots[at]!.split(' ');
    if (type === 'tree' && OID.test(oid)) level.push({ commit, tree: { oid, trie } });
    else carrying.add(commit);
  }
  while (level.length > 0) {
    const oids = [...new Set(level.map(({ tree }) => tree.oid))];
    const objects = yield* objectsAt(git, dir, oids, { env: literalObjects, extendEnv: true });
    const reads = new Map(oids.map((oid, at) => [oid, objectOf(dir, objects[at]!)]));
    const next: { readonly commit: string; readonly tree: Directory }[] = [];
    for (const { commit, tree } of level) {
      const reading = reads.get(tree.oid)!;
      const below: Directory[] = [];
      if (reading._tag === 'Failure') failedBelow(tree.trie, reading.failure, found.get(commit)!);
      else descend(dir, tree, reading.success, found.get(commit)!, below);
      for (const one of below) next.push({ commit, tree: one });
    }
    level = next;
  }
  for (const [commit, paths] of found) if (paths.has(path)) carrying.add(commit);
  return carrying;
});
