import { afterAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { git, onGit, release, tempRepo } from './testing/fixture.js';
import { discardAt, stageAt, unstageAt } from './stage.js';
import { statusAt } from './status.js';

afterAll(release);

const named = (entries: readonly { readonly path: string }[]): string[] => entries.map((entry) => entry.path).sort();

// @ts-expect-error an empty path list is not a non-empty one
const neverStaged = (dir: string) => stageAt({ run: () => Effect.never }, dir, [] as readonly string[]);

test('one path of three stages by name, and a path holding a newline is the path git acts on', async () => {
  const root = await tempRepo('git-stage-');
  const odd = 'we\nird.txt';
  for (const name of [odd, 'two.txt', 'three.txt']) writeFileSync(join(root, name), 'born\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  for (const name of [odd, 'two.txt', 'three.txt']) writeFileSync(join(root, name), 'changed\n');

  const acted = await onGit((service) => stageAt(service, root, [odd]));
  const seen = await onGit((service) => statusAt(service, root, { untracked: 'no' }));

  expect(acted).toEqual([odd]);
  expect(named(seen.entries.staged)).toEqual([odd]);
  expect(named(seen.entries.unstaged)).toEqual(['three.txt', 'two.txt']);
}, 6_000);

test('a bracket in a name stages that name and not the neighbour a glob would match', async () => {
  const root = await tempRepo('git-stage-glob-');
  for (const name of ['a[b].txt', 'ab.txt']) writeFileSync(join(root, name), 'born\n');
  await git(root, ['add', '--', 'a[b].txt', 'ab.txt']);
  await git(root, ['commit', '-qm', 'born']);
  for (const name of ['a[b].txt', 'ab.txt']) writeFileSync(join(root, name), 'changed\n');

  const acted = await onGit((service) => stageAt(service, root, ['a[b].txt']));
  const seen = await onGit((service) => statusAt(service, root, { untracked: 'no' }));

  expect(acted).toEqual(['a[b].txt']);
  expect(named(seen.entries.staged)).toEqual(['a[b].txt']);
  expect(named(seen.entries.unstaged)).toEqual(['ab.txt']);
}, 6_000);

test('unstaging a staged deletion brings the index entry back and leaves the file gone', async () => {
  const root = await tempRepo('git-unstage-');
  writeFileSync(join(root, 'gone.txt'), 'here\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  await git(root, ['rm', '-q', '--', 'gone.txt']);

  const acted = await onGit((service) => unstageAt(service, root, ['gone.txt']));
  const seen = await onGit((service) => statusAt(service, root, { untracked: 'no' }));

  expect(acted).toEqual(['gone.txt']);
  expect(seen.entries.staged).toEqual([]);
  expect(named(seen.entries.unstaged)).toEqual(['gone.txt']);
  expect(seen.entries.unstaged[0]?.status).toBe('deleted');
  expect(existsSync(join(root, 'gone.txt'))).toBe(false);
}, 6_000);

test('a discard writes a tracked path back from the index and deletes an untracked one, and touches no neighbour', async () => {
  const root = await tempRepo('git-discard-');
  writeFileSync(join(root, 'tracked.txt'), 'committed\n');
  writeFileSync(join(root, 'neighbour.txt'), 'committed\n');
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'born']);
  writeFileSync(join(root, 'tracked.txt'), 'edited by hand\n');
  writeFileSync(join(root, 'neighbour.txt'), 'edited by hand\n');
  writeFileSync(join(root, 'new.txt'), 'never added\n');
  writeFileSync(join(root, 'kept.txt'), 'never added either\n');

  const acted = await onGit((service) => discardAt(service, root, { tracked: ['tracked.txt'], untracked: ['new.txt'] }));

  expect(acted).toEqual(['tracked.txt', 'new.txt']);
  expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('committed\n');
  expect(existsSync(join(root, 'new.txt'))).toBe(false);
  expect(readFileSync(join(root, 'neighbour.txt'), 'utf8')).toBe('edited by hand\n');
  expect(existsSync(join(root, 'kept.txt'))).toBe(true);
}, 6_000);

test('unstaging a newly added path returns it to untracked and leaves the file where it stands', async () => {
  const root = await tempRepo('git-unstage-added-');
  writeFileSync(join(root, 'new.txt'), 'never committed\n');
  await git(root, ['add', '--', 'new.txt']);

  const acted = await onGit((service) => unstageAt(service, root, ['new.txt']));
  const seen = await onGit((service) => statusAt(service, root, { untracked: 'all' }));

  expect(acted).toEqual(['new.txt']);
  expect(seen.entries.staged).toEqual([]);
  expect(named(seen.entries.untracked)).toEqual(['new.txt']);
  expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('never committed\n');
}, 6_000);

test('a discard deletes the path it was named and not the neighbours its name would match as a glob', async () => {
  const root = await tempRepo('git-discard-glob-');
  writeFileSync(join(root, 'a[b].txt'), 'the one named\n');
  writeFileSync(join(root, 'ab.txt'), 'the one a glob would take\n');

  const acted = await onGit((service) => discardAt(service, root, { untracked: ['a[b].txt'] }));

  expect(acted).toEqual(['a[b].txt']);
  expect(existsSync(join(root, 'a[b].txt'))).toBe(false);
  expect(readFileSync(join(root, 'ab.txt'), 'utf8')).toBe('the one a glob would take\n');
}, 6_000);

test('a pathspec matching nothing refuses with git own words and stages nothing beside it', async () => {
  const root = await tempRepo('git-stage-refused-');
  writeFileSync(join(root, 'real.txt'), 'here\n');

  const failure = await onGit((service) => Effect.flip(stageAt(service, root, ['nosuch.txt'])));
  const seen = await onGit((service) => statusAt(service, root, { untracked: 'all' }));

  expect(failure._tag).toBe('GitRefused');
  expect(failure._tag === 'GitRefused' && failure.message).not.toBe('');
  expect(seen.entries.staged).toEqual([]);
  expect(named(seen.entries.untracked)).toEqual(['real.txt']);
}, 6_000);
