import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';
import { git } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';

it.live(
  'a resolved merge concludes with the first landing that carries one of its paths and keeps the resolution of the paths it leaves',
  () =>
    Effect.gen(function* () {
      const baseText = 'header\nold\nmiddle\nend\n';
      const resolvedText = baseText.replace('old\n', 'new\n');
      const { born, doors, write, read, files, root } = yield* nativeLanding({
        'mixed.txt': baseText,
        'other.txt': baseText,
        'local.txt': 'base\n',
      });
      const actor = yield* born();
      yield* git(root, 'checkout', '-qb', 'incoming');
      yield* files.writeFileString(join(root, 'mixed.txt'), resolvedText);
      yield* files.writeFileString(join(root, 'other.txt'), resolvedText);
      yield* git(root, 'add', '--', 'mixed.txt', 'other.txt');
      yield* git(root, 'commit', '-qm', 'incoming');
      const tip = yield* suiteGit(root, 'rev-parse', 'HEAD');
      yield* git(root, 'checkout', '-q', 'main');
      yield* files.writeFileString(join(root, 'local.txt'), 'local\n');
      yield* git(root, 'add', '--', 'local.txt');
      yield* git(root, 'commit', '-qm', 'local change');
      const head = yield* suiteGit(root, 'rev-parse', 'HEAD');
      yield* git(root, 'merge', '--no-commit', '--no-ff', 'incoming');
      const mixedWorking = resolvedText.replace('end\n', 'owned\n');
      yield* write(actor.threadId, 'mixed.txt', mixedWorking);
      expect(yield* doors.atNative('submit_work', { subject: 'merge incoming', tasks: [] }, actor)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['mixed.txt', 'other.txt'] } },
      });
      expect(yield* read('mixed.txt')).toBe(mixedWorking);
      expect(yield* read('other.txt')).toBe(resolvedText);
      const commit = yield* suiteGit(root, 'rev-parse', 'HEAD');
      expect(yield* suiteGit(root, 'rev-list', '--parents', '-1', 'HEAD')).toBe(`${commit} ${head} ${tip}`);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a bare submit lands its files whole, credits the peer that wrote in them and names those whose bytes no tool recorded', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding({
      'notes.txt': 'one\ntwo\nthree\n',
      'outside.txt': 'one\ntwo\nthree\n',
    });
    const actor = yield* born();
    const peer = yield* born();
    const migration = 'migration.sql';
    const first = 'ALTER TABLE threads ADD change_rev INTEGER DEFAULT 0;\n';
    const complete = `${first}ALTER TABLE threads ADD change_open INTEGER DEFAULT 0;\n`;
    yield* files.writeFileString(join(root, migration), first);
    yield* write(actor.threadId, migration, complete);
    yield* write(peer.threadId, 'notes.txt', 'ONE\ntwo\nthree\n');
    yield* write(actor.threadId, 'notes.txt', 'ONE\ntwo\nTHREE\n');
    yield* files.writeFileString(join(root, 'outside.txt'), 'ONE\ntwo\nthree\n');
    yield* write(actor.threadId, 'outside.txt', 'ONE\ntwo\nTHREE\n');
    expect(yield* doors.atNative('submit_work', { subject: 'land the migration', tasks: [] }, actor)).toMatchObject({
      class: 'answer',
      value: {
        submitted: {
          status: 'landed',
          committed: [migration, 'notes.txt', 'outside.txt'],
          carried: [{ path: 'notes.txt', holders: [peer.threadId] }],
          unattributed: [migration, 'outside.txt'],
        },
      },
    });
    expect(yield* read(migration)).toBe(complete);
    expect(yield* read('notes.txt')).toBe('ONE\ntwo\nTHREE\n');
    expect(yield* read('outside.txt')).toBe('ONE\ntwo\nTHREE\n');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
