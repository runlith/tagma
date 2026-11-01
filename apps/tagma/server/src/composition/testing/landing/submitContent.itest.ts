import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { nativeLanding } from './native.js';
import { git } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';
import { scriptedModel } from '../scriptedModel.js';

it.live('a resolved merge keeps its indexed allowance when the caller holds only the replaced line’s deletion', () =>
  Effect.gen(function* () {
    const path = 'checks/builtins.ts';
    const allowance = (lines: number) => `export const names = {
  builtin: 'names',
  params: {
    base: '', files: { extensions: ['.ts'], exclude: [] }, uncovered: [], modules: [], services: ['Context.Service'], errors: ['Data.TaggedError'], glossary: [],
    checks: { F4: { lines: 700, allowances: [{
      lines: ${lines},
      path: 'src/example.ts',
      why: 'one subject',
    }] } },
  },
};\n`;
    const base = allowance(814);
    const resolved = allowance(817);
    const baseText = 'header\nold\nmiddle\nend\n';
    const resolvedText = baseText.replace('old\n', 'new\n');
    const { world, projectId, born, doors, write, read, files, root } = yield* nativeLanding({
      [path]: base,
      'mixed.txt': baseText,
      'ambiguous.txt': baseText,
      'replacement.txt': baseText,
      'tagma.config.ts': "import { names } from './checks/builtins';\nexport default { inspections: { names } };\n",
      'local.txt': 'base\n',
    });
    const actor = yield* born();
    const op = (id: string, input: unknown) => world.op(id, input, `project=${projectId}`);
    const roots = yield* op('list_root_blocks', {});
    const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
    const created = yield* op('create_block', { parentId, tags: ['rule'], title: 'Bound source size' });
    const rule = (created.body as { block: { name: string } }).block.name;
    expect(
      yield* op('enforce_rule', {
        blockId: rule,
        base: null,
        strictness: 'gate',
        inspection: 'names',
        on: [{ op: 'submit_work', phase: 'before' }],
      }),
    ).toMatchObject({ status: 200 });
    yield* git(root, 'checkout', '-qb', 'incoming');
    yield* files.writeFileString(join(root, path), resolved);
    yield* files.writeFileString(join(root, 'mixed.txt'), resolvedText);
    yield* files.writeFileString(join(root, 'ambiguous.txt'), resolvedText);
    yield* files.writeFileString(join(root, 'replacement.txt'), resolvedText);
    yield* git(root, 'add', '--', path, 'mixed.txt', 'ambiguous.txt', 'replacement.txt');
    yield* git(root, 'commit', '-qm', 'incoming allowance');
    const tip = yield* suiteGit(root, 'rev-parse', 'HEAD');
    yield* git(root, 'checkout', '-q', 'main');
    yield* files.writeFileString(join(root, 'local.txt'), 'local\n');
    yield* git(root, 'add', '--', 'local.txt');
    yield* git(root, 'commit', '-qm', 'local change');
    const head = yield* suiteGit(root, 'rev-parse', 'HEAD');
    yield* git(root, 'merge', '--no-commit', '--no-ff', 'incoming');
    yield* files.writeFileString(join(root, path), base);
    yield* write(actor.threadId, path, base.replace('      lines: 814,\n', ''));
    yield* files.writeFileString(join(root, path), resolved);
    yield* files.writeFileString(join(root, 'mixed.txt'), baseText);
    yield* write(actor.threadId, 'mixed.txt', baseText.replace('old\n', '').replace('end\n', 'owned\n'));
    const mixedWorking = resolvedText.replace('header\n', 'external\n').replace('end\n', 'owned\n');
    yield* files.writeFileString(join(root, 'mixed.txt'), mixedWorking);
    yield* files.writeFileString(join(root, 'replacement.txt'), baseText);
    yield* write(actor.threadId, 'replacement.txt', baseText.replace('old\n', 'owned\n'));
    const replacementWorking = resolvedText.replace('new\n', 'new\nowned\n');
    yield* files.writeFileString(join(root, 'replacement.txt'), replacementWorking);
    yield* files.writeFileString(join(root, 'ambiguous.txt'), baseText);
    yield* write(actor.threadId, 'ambiguous.txt', baseText.replace('old\n', ''));
    const ambiguousWorking = resolvedText.replace('new\n', 'external\n');
    yield* files.writeFileString(join(root, 'ambiguous.txt'), ambiguousWorking);
    expect(yield* doors.atNative('submit_work', { subject: 'merge ambiguous', paths: ['ambiguous.txt'], tasks: [] }, actor)).toMatchObject({
      class: 'refusal',
      code: 'walk-cut',
    });
    expect(yield* suiteGit(root, 'show', ':ambiguous.txt')).toBe(resolvedText.trim());
    expect(yield* files.readFileString(join(root, 'ambiguous.txt'))).toBe(ambiguousWorking);
    expect(yield* suiteGit(root, 'show', `:${path}`)).toBe(resolved.trim());
    expect(
      yield* doors.atNative('submit_work', { subject: 'merge incoming', paths: [path, 'mixed.txt', 'replacement.txt'], tasks: [] }, actor),
    ).toMatchObject({
      class: 'answer',
      value: { submitted: { status: 'landed' } },
    });
    expect(yield* read(path)).toBe(resolved);
    expect(yield* read('mixed.txt')).toBe(resolvedText.replace('end\n', 'owned\n'));
    expect(yield* read('replacement.txt')).toBe(replacementWorking);
    expect(yield* read('ambiguous.txt')).toBe(resolvedText);
    expect(yield* files.readFileString(join(root, 'mixed.txt'))).toBe(mixedWorking);
    expect(yield* files.readFileString(join(root, 'ambiguous.txt'))).toBe(ambiguousWorking);
    const commit = yield* suiteGit(root, 'rev-parse', 'HEAD');
    expect(yield* suiteGit(root, 'rev-list', '--parents', '-1', 'HEAD')).toBe(`${commit} ${head} ${tip}`);
    expect(yield* files.readFileString(join(root, path))).toBe(resolved);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

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
