import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';
import { scriptedModel } from '../scriptedModel.js';

it.live('native submit_work refuses an unowned new-file base instead of publishing only the recorded tail or renamed JSON lines', () =>
  Effect.gen(function* () {
    const { born, doors, write, read, files, root } = yield* nativeLanding(
      {
        'notes.txt': 'one\ntwo\nthree\n',
        'outside.txt': 'one\ntwo\nthree\n',
      },
      { models: scriptedModel() },
    );
    const actor = yield* born();
    const writer = yield* born(actor.threadId);
    const peer = yield* born();
    const migration = 'migration.sql';
    const snapshot = 'snapshot.json';
    const first = 'ALTER TABLE threads ADD change_rev INTEGER DEFAULT 0;\n';
    const complete = `${first}ALTER TABLE threads ADD change_open INTEGER DEFAULT 0;\nCREATE TRIGGER changed AFTER INSERT ON threads BEGIN UPDATE threads SET change_rev = 1; END;\n`;
    const generated = '{\n  "name": "plugin",\n  "columns": [\n    "id",\n    "plugin"\n  ]\n}\n';
    const renamed = generated.replaceAll('plugin', 'app');
    yield* files.writeFileString(join(root, migration), first);
    yield* write(actor.threadId, migration, complete);
    yield* files.writeFileString(join(root, snapshot), generated);
    yield* write(writer.threadId, snapshot, renamed);
    yield* write(peer.threadId, 'recorded.json', generated);
    yield* write(actor.threadId, 'recorded.json', renamed);
    yield* write(peer.threadId, 'notes.txt', 'ONE\ntwo\nthree\n');
    yield* write(actor.threadId, 'notes.txt', 'ONE\ntwo\nTHREE\n');
    yield* files.writeFileString(join(root, 'outside.txt'), 'ONE\ntwo\nthree\n');
    yield* write(actor.threadId, 'outside.txt', 'ONE\ntwo\nTHREE\n');
    expect(yield* doors.atNative('submit_work', { subject: 'land the migration', paths: [migration] }, actor)).toMatchObject({
      class: 'refusal',
      code: 'lines-held',
      reason: expect.stringContaining(migration),
    });
    const refused = yield* doors.atNative('submit_work', { subject: 'land generated content', taking: [writer.threadId] }, actor);
    expect(refused).toMatchObject({ class: 'refusal', code: 'lines-held' });
    if (refused.class !== 'refusal') return;
    expect(refused.reason).toContain(migration);
    expect(refused.reason).toContain(snapshot);
    expect(refused.reason).toContain('nobody');
    expect(yield* read('notes.txt')).toBe('one\ntwo\nthree\n');
    expect(
      yield* doors.atNative(
        'submit_work',
        { subject: 'carry generated content', taking: [writer.threadId], whole: [migration, snapshot] },
        actor,
      ),
    ).toMatchObject({
      class: 'answer',
      value: {
        submitted: {
          status: 'landed',
          committed: [migration, 'notes.txt', 'outside.txt', 'recorded.json', snapshot],
          carried: [{ path: 'recorded.json', holders: [peer.threadId] }],
          unattributed: ['outside.txt'],
        },
      },
    });
    expect(yield* read(migration)).toBe(complete);
    expect(yield* read(snapshot)).toBe(renamed);
    expect(yield* read('recorded.json')).toBe(renamed);
    expect(yield* read('notes.txt')).toBe('one\ntwo\nTHREE\n');
    expect(yield* files.readFileString(join(root, 'notes.txt'))).toBe('ONE\ntwo\nTHREE\n');
    expect(yield* read('outside.txt')).toBe('one\ntwo\nTHREE\n');
    expect(yield* files.readFileString(join(root, 'outside.txt'))).toBe('ONE\ntwo\nTHREE\n');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
