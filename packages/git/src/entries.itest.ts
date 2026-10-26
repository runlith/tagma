import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { GitUnavailable, type Git } from './Git.js';
import {
  blobAt,
  blobBytesAt,
  blobPrefixAt,
  blobsAt,
  changedBetween,
  filesUnder,
  ignoredAmong,
  parentOf,
  stagedBlobAt,
  textsAt,
  treeEntriesAt,
} from './entries.js';
import { git, onGit, release, tempRepo } from './testing/fixture.js';

afterAll(release);

const failingOn = (service: Git['Service'], at: number): Git['Service'] => {
  let seen = 0;
  return {
    run: (args, options) => {
      seen += 1;
      return seen === at ? Effect.fail(new GitUnavailable({ command: args, reason: 'nothing spawned' })) : service.run(args, options);
    },
  };
};

test('a blob is read byte for byte, and a path the revision does not hold is absent', async () => {
  const root = await tempRepo('git-blob-');
  writeFileSync(join(root, 'kept.txt'), 'no newline here');
  writeFileSync(join(root, 'closed.txt'), 'two\n\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);

  const kept = await onGit((service) => blobAt(service, root, 'HEAD', 'kept.txt'));
  const closed = await onGit((service) => blobAt(service, root, 'HEAD', 'closed.txt'));
  const missing = await onGit((service) => blobAt(service, root, 'HEAD', 'never.txt'));

  expect(kept).toBe('no newline here');
  expect(closed).toBe('two\n\n');
  expect(missing).toBeNull();
  const whole = await onGit((service) => treeEntriesAt(service, root, 'HEAD', null));
  expect([...whole.entries.keys()].sort()).toEqual(['closed.txt', 'kept.txt']);
  expect(whole.entries.get('kept.txt')?.mode).toBe('100644');
  expect(whole.unread.size).toBe(0);
  const failed = await onGit((service) => treeEntriesAt(failingOn(service, 1), root, 'HEAD', null));
  expect(failed.entries.size).toBe(0);
  expect(failed.unread.get('')).toContain('nothing spawned');
});

test('a blob read as bytes keeps bytes no text decode survives, from a revision and from the index, and a missing one is absent', async () => {
  const root = await tempRepo('git-blob-bytes-');
  const committed = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0a]);
  const staged = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x80]);
  writeFileSync(join(root, 'mark.png'), committed);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'mark']);
  writeFileSync(join(root, 'mark.png'), staged);
  await git(root, ['add', 'mark.png']);

  const atHead = await onGit((service) => blobBytesAt(service, root, 'HEAD', 'mark.png'));
  const atIndex = await onGit((service) => blobBytesAt(service, root, '', 'mark.png'));
  const missing = await onGit((service) => blobBytesAt(service, root, 'HEAD', 'never.png'));

  expect(atHead).toEqual(committed);
  expect(atIndex).toEqual(staged);
  expect(missing).toBeNull();
});

test('a blob prefix answers the first bytes asked of a blob longer than them, and a missing blob is absent', async () => {
  const root = await tempRepo('git-blob-prefix-');
  const long = Uint8Array.from({ length: 20_000 }, (_, at) => at % 251);
  writeFileSync(join(root, 'long.bin'), long);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'long']);

  const prefix = await onGit((service) => blobPrefixAt(service, root, 'HEAD', 'long.bin', 8_000));
  const missing = await onGit((service) => blobPrefixAt(service, root, 'HEAD', 'never.bin', 8_000));

  expect(prefix).toEqual(long.subarray(0, 8_000));
  expect(missing).toBeNull();
});

test('a path list past one argv batch answers every path, and a failed batch answers unread for its own', async () => {
  const root = await tempRepo('git-batched-');
  const paths = Array.from({ length: 201 }, (_, at) => `f${at}.txt`);
  for (const name of paths) writeFileSync(join(root, name), `${name}\n`);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);

  const whole = await onGit((service) => treeEntriesAt(service, root, 'HEAD', paths));
  const partial = await onGit((service) => treeEntriesAt(failingOn(service, 2), root, 'HEAD', paths));
  const refusing = (service: Git['Service']): Git['Service'] => ({
    run: (args, options) =>
      args.includes(':(literal)f7.txt')
        ? Effect.fail(new GitUnavailable({ command: args, reason: 'f7 refused' }))
        : service.run(args, options),
  });
  const among = await onGit((service) => treeEntriesAt(refusing(service), root, 'HEAD', paths));

  expect(whole.entries.size).toBe(201);
  expect(whole.entries.get('f200.txt')?.mode).toBe('100644');
  expect([...whole.unread.keys()]).toEqual([]);
  expect(partial.entries.size).toBe(200);
  expect([...partial.unread.keys()]).toEqual(['f200.txt']);
  expect(partial.entries.has('f200.txt')).toBe(false);
  expect(among.entries.size).toBe(200);
  expect([...among.unread.keys()]).toEqual(['f7.txt']);
  expect(among.unread.get('f7.txt')).toContain('f7 refused');
});

test('a path is read as the name it is, and one outside the repository is unread without git being asked', async () => {
  const root = await tempRepo('git-literal-');
  for (const name of ['one.txt', 'a[b].txt', 'ab.txt']) writeFileSync(join(root, name), 'born\n');
  await git(root, ['add', '--', 'one.txt', 'a[b].txt', 'ab.txt']);
  await git(root, ['commit', '-qm', 'born']);
  const magic = ':(bogus)two.txt';
  const outside = join(root, '..', 'elsewhere.ts');

  const read = await onGit((service) => treeEntriesAt(service, root, 'HEAD', ['one.txt', magic, 'a[b].txt', outside]));

  expect([...read.entries.keys()].sort()).toEqual(['a[b].txt', 'one.txt']);
  expect(read.unread.has(magic)).toBe(false);
  expect([...read.unread.keys()]).toEqual([outside]);
  expect(read.unread.get(outside)).toBe(`${outside} is outside the repository at ${root}`);
});

test('a tracked name opening with two dots is inside the repository', async () => {
  const root = await tempRepo('git-dotdot-');
  writeFileSync(join(root, '..hidden'), 'born\n');
  await git(root, ['add', '--', '..hidden']);
  await git(root, ['commit', '-qm', 'born']);

  const read = await onGit((service) => treeEntriesAt(service, root, 'HEAD', ['..hidden']));

  expect([...read.entries.keys()]).toEqual(['..hidden']);
  expect([...read.unread.keys()]).toEqual([]);
});

test('a path outside the repository is unreadable, never an absent file', async () => {
  const root = await tempRepo('git-blob-outside-');
  writeFileSync(join(root, 'kept.txt'), 'here\n');
  await git(root, ['add', '--', 'kept.txt']);
  await git(root, ['commit', '-qm', 'born']);

  const outside = join(root, '..', 'not-this-tree', 'notes.md');
  const read = await onGit((service) => Effect.result(blobAt(service, root, 'HEAD', outside)));
  expect(read._tag).toBe('Failure');
  expect(await onGit((service) => blobAt(service, root, 'HEAD', 'never-born.txt'))).toBeNull();
});

test('a revision opening with a dash is the revision it names, never a flag git runs', async () => {
  const root = await tempRepo('git-revision-dash-');
  writeFileSync(join(root, 'kept.txt'), 'born\n');
  writeFileSync(join(root, '-x.txt'), 'dash\n');
  await git(root, ['add', '--', 'kept.txt', '-x.txt']);
  await git(root, ['commit', '-qm', 'born']);
  await git(root, ['update-ref', 'refs/heads/-x', 'HEAD']);
  const spilled = join(root, 'spilled');

  const entries = await onGit((service) => treeEntriesAt(service, root, '-x', ['kept.txt']));
  const blob = await onGit((service) => blobAt(service, root, '-x', 'kept.txt'));
  const staged = await onGit((service) => stagedBlobAt(service, root, '-x.txt'));
  const obeyed = await onGit((service) => blobAt(service, root, `--output=${spilled}`, 'kept.txt'));

  expect(entries.entries.get('kept.txt')?.mode).toBe('100644');
  expect([...entries.unread.keys()]).toEqual([]);
  expect(blob).toBe('born\n');
  expect(staged).toBe('dash\n');
  expect(existsSync(`${spilled}:kept.txt`)).toBe(false);
  expect(obeyed).toBeNull();
});

test('one cat-file session answers the texts of two trees, a path a tree lacks as absent and bytes that are not UTF-8 as unread', async () => {
  const root = await tempRepo('git-blobs-');
  const names = Array.from({ length: 60 }, (_, at) => `src/f${at}.ts`);
  mkdirSync(join(root, 'src'), { recursive: true });
  for (const name of names) writeFileSync(join(root, name), `import './${name}';\n`);
  writeFileSync(join(root, 'wide.ts'), 'é → 中\0no newline');
  writeFileSync(join(root, 'raw.bin'), Uint8Array.of(0xff, 0xfe, 0x78));
  await git(root, ['add', '-A']);
  const base = await git(root, ['write-tree']);
  for (const name of names) writeFileSync(join(root, name), `import './${name}.next';\n`);
  rmSync(join(root, 'wide.ts'));
  writeFileSync(join(root, 'born.ts'), 'born\n');
  await git(root, ['add', '-A']);
  const built = await git(root, ['write-tree']);
  let spawned = 0;
  const counted = (service: Git['Service']): Git['Service'] => ({
    run: (args, options) => {
      spawned += 1;
      return service.run(args, options);
    },
  });
  const asked = [
    ...names.flatMap((path) => [
      { tree: base, path },
      { tree: built, path },
    ]),
    { tree: base, path: 'wide.ts' },
    { tree: built, path: 'wide.ts' },
    { tree: base, path: 'born.ts' },
    { tree: built, path: 'born.ts' },
    { tree: built, path: 'src' },
    { tree: built, path: 'raw.bin' },
    { tree: built, path: join(root, '..', 'elsewhere.ts') },
  ];

  const reads = await onGit((service) => blobsAt(counted(service), root, asked));

  expect(spawned).toBe(1);
  expect(reads[1]).toEqual({
    status: 'text',
    object: await git(root, ['rev-parse', `${built}:src/f0.ts`]),
    text: `import './src/f0.ts.next';\n`,
  });
  for (const [at, name] of names.entries()) {
    expect(reads[2 * at]).toMatchObject({ status: 'text', text: `import './${name}';\n` });
    expect(reads[2 * at + 1]).toMatchObject({ status: 'text', text: `import './${name}.next';\n` });
  }
  expect(reads.slice(names.length * 2).map((read) => (read.status === 'text' ? read.text : read.status))).toEqual([
    'é → 中\0no newline',
    'absent',
    'absent',
    'born\n',
    'absent',
    'unread',
    'unread',
  ]);
});

test('texts of many paths answer what blobAt answers each, from two sessions and a re-run only for what the batch cannot read', async () => {
  const root = await tempRepo('git-texts-');
  const names = Array.from({ length: 40 }, (_, at) => `src/f${at}.ts`);
  mkdirSync(join(root, 'src'), { recursive: true });
  for (const name of names) writeFileSync(join(root, name), `export const at = '${name}';\n`);
  writeFileSync(join(root, 'marked.ts'), '\uFEFFmarked\n');
  writeFileSync(join(root, 'latin.ts'), Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x0a));
  writeFileSync(join(root, 'wide.ts'), 'x'.repeat(64));
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  let spawned = 0;
  const counted = (service: Git['Service']): Git['Service'] => ({
    run: (args, options) => {
      spawned += 1;
      return service.run(args, options);
    },
  });
  const paths = [...names, 'marked.ts', 'latin.ts', 'wide.ts', 'never.ts', 'src', join(root, '..', 'elsewhere.ts')];
  const options = { capture: 32 };

  const texts = await onGit((service) =>
    textsAt(
      counted(service),
      root,
      paths.map((path) => ({ tree: 'HEAD', path })),
      options,
    ),
  );
  const asked = spawned;
  const alone = await onGit((service) => Effect.forEach(paths, (path) => Effect.result(blobAt(service, root, 'HEAD', path, options))));

  expect(asked).toBe(4);
  const shown = (read: (typeof texts)[number] | undefined) =>
    read === undefined ? 'missing' : read._tag === 'Success' ? read.success : read.failure._tag;
  expect(texts.map(shown)).toEqual(alone.map(shown).map((one, at) => (paths[at] === 'src' ? null : one)));
  expect(texts.slice(0, 2).map(shown)).toEqual([`export const at = 'src/f0.ts';\n`, `export const at = 'src/f1.ts';\n`]);
  expect(texts.slice(names.length).map(shown)).toEqual(['\uFEFFmarked\n', 'caf\uFFFD\n', 'GitAnswerInvalid', null, null, 'GitUnreadable']);
});

test('the ignored paths among those asked are the ones answered, and none ignored is not a failure', async () => {
  const root = await tempRepo('git-ignored-');
  writeFileSync(join(root, '.gitignore'), 'build/\n');
  mkdirSync(join(root, 'build'), { recursive: true });
  writeFileSync(join(root, 'build', 'out.js'), 'made\n');
  writeFileSync(join(root, 'src.ts'), 'written\n');

  const ignored = await onGit((service) => ignoredAmong(service, root, ['build/out.js', 'src.ts']));
  const none = await onGit((service) => ignoredAmong(service, root, ['src.ts']));

  expect([...ignored]).toEqual(['build/out.js']);
  expect([...none]).toEqual([]);
});

test('a place answers what git tracks under it, and what it does not ignore where a caller asks for those', async () => {
  const root = await tempRepo('git-under-');
  writeFileSync(join(root, '.gitignore'), 'skipped.log\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'tracked.ts'), 'born\n');
  writeFileSync(join(root, 'elsewhere.ts'), 'born\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  writeFileSync(join(root, 'src', 'untracked.ts'), 'never added\n');
  writeFileSync(join(root, 'src', 'skipped.log'), 'ignored\n');

  const cached = await onGit((service) => filesUnder(service, root, 'src'));
  const withOthers = await onGit((service) => filesUnder(service, root, 'src', { others: true }));

  expect(cached).toEqual(['src/tracked.ts']);
  expect([...withOthers].sort()).toEqual(['src/tracked.ts', 'src/untracked.ts']);
});

test('a commit names its parent and says which paths two commits differ in', async () => {
  const root = await tempRepo('git-history-');
  writeFileSync(join(root, 'one.txt'), 'born\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'first']);
  const first = await git(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'two.txt'), 'later\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'second']);
  const second = await git(root, ['rev-parse', 'HEAD']);

  const parent = await onGit((service) => parentOf(service, root, second));
  const origin = await git(root, ['rev-list', '--max-parents=0', 'HEAD']);
  const born = await onGit((service) => parentOf(service, root, origin));
  const between = await onGit((service) => changedBetween(service, root, first, second));

  expect(parent).toBe(first);
  expect(born).toBeNull();
  expect(between).toEqual(['two.txt']);
});
