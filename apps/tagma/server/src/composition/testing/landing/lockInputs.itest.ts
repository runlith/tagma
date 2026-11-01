import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { createTools } from '@runlith/agent-tools';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import { call } from '../checkoutFixture.js';
import { join } from 'node:path';
import { nativeLanding } from './native.js';
import { git } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';

const RUN = ['bun', 'install', '--lockfile-only', '--ignore-scripts'] as const;
const COMMAND = RUN.join(' ');
const PEER = 'packages/peer/package.json';

const observed = Effect.fnUntraced(function* (
  fixture: Effect.Success<ReturnType<typeof nativeLanding>>,
  threadId: string,
  command: string,
) {
  const shell = createTools({
    cwd: fixture.root,
    world: makeMachineWorld(() => null),
    commandTimes: unruledTimes,
    searchMs: LONGEST_ACT_MS,
    unowned: ['.tagma'],
    changes: Context.get(fixture.world.runtime.owners, ChangeRecord).changes({ work: { projectId: fixture.projectId, threadId } }),
  }).bash;
  yield* call(shell, { command, description: 'Generate the working output' });
});

const incident = Effect.fnUntraced(function* () {
  const manifest = (name: string, dependencies = {}) => `${JSON.stringify({ name, version: '1.0.0', dependencies }, null, 2)}\n`;
  const rootManifest = { name: 'root', private: true, workspaces: ['packages/*'] };
  const peerBase = manifest('peer');
  const fixture = yield* nativeLanding({
    'package.json': `${JSON.stringify(rootManifest, null, 2)}\n`,
    [PEER]: peerBase,
    'packages/lib/package.json': manifest('lib'),
    '.gitattributes': 'bun.lock linguist-generated=false\n',
    '.gitignore': 'node_modules/\n',
  });
  const { root, born, write, files } = fixture;
  expect((yield* spawnedEffect(RUN, { cwd: root })).exitCode).toBe(0);
  yield* git(root, 'add', '--', 'bun.lock');
  yield* git(root, 'commit', '-qm', 'lock the base workspace');
  const head = yield* suiteGit(root, 'rev-parse', 'HEAD');
  const actor = yield* born();
  const peer = yield* born();
  yield* write(peer.threadId, PEER, manifest('peer', { lib: 'workspace:*' }));
  const ownManifest = `${JSON.stringify({ ...rootManifest, dependencies: { lib: 'workspace:*' } }, null, 2)}\n`;
  yield* write(actor.threadId, 'package.json', ownManifest);
  yield* observed(fixture, actor.threadId, COMMAND);
  const working = yield* files.readFileString(join(root, 'bun.lock'));
  return { ...fixture, actor, peer, peerBase, ownManifest, working, head };
});

it.live('submit_work refuses command-derived output over omitted inputs and names the recorded command and holders', () =>
  Effect.gen(function* () {
    const { root, doors, actor, peer, head, files, working } = yield* incident();
    const result = yield* doors.atNative(
      'submit_work',
      { subject: 'land the dependency change', paths: ['package.json', 'bun.lock'], whole: ['bun.lock'], tasks: [] },
      actor,
    );
    expect(result).toMatchObject({ class: 'refusal', code: 'derive-required' });
    if (result.class !== 'refusal') return;
    expect(result.reason).toContain(PEER);
    expect(result.reason).toContain(peer.threadId);
    expect(result.reason).toContain(COMMAND);
    const failed = yield* doors.atNative(
      'submit_work',
      {
        subject: 'derive the dependency change',
        paths: ['package.json', 'bun.lock'],
        derive: [{ paths: ['bun.lock'], run: ['sh', '-c', 'printf generator-failed >&2; exit 7'] }],
        tasks: [],
      },
      actor,
    );
    expect(failed).toMatchObject({ class: 'refusal', code: 'derive-failed', reason: expect.stringContaining('generator-failed') });
    expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(yield* files.readFileString(join(root, 'bun.lock'))).toBe(working);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('submit_work derives its lockfile over committed manifests and preserves the peer dependency in the working output', () =>
  Effect.gen(function* () {
    const { root, doors, actor, read, files, working, peerBase, ownManifest } = yield* incident();
    const result = yield* doors.atNative(
      'submit_work',
      {
        subject: 'land the dependency change',
        paths: ['package.json', 'bun.lock'],
        derive: [{ paths: ['bun.lock'], run: RUN }],
        tasks: [],
      },
      actor,
    );
    expect(result).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed' } } });
    expect(yield* read('package.json')).toBe(ownManifest);
    expect(yield* read(PEER)).toBe(peerBase);
    expect(yield* files.readFileString(join(root, 'bun.lock'))).toBe(working);
    expect(yield* read('bun.lock')).not.toBe(working);
    const fresh = join(yield* files.makeTempDirectoryScoped({ prefix: 'lockfile-commit-' }), 'checkout');
    yield* git(root, 'worktree', 'add', '--detach', fresh, 'HEAD');
    const frozen = yield* spawnedEffect(['bun', 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: fresh });
    expect({ exit: frozen.exitCode, stderr: new TextDecoder().decode(frozen.stderr) }).toMatchObject({ exit: 0 });
    yield* git(root, 'worktree', 'remove', '--force', fresh);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a file-tool edit keeps the program origin of the generated bytes it leaves intact', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeLanding({ 'artifact.txt': 'base\n', 'artifact.bin': 'base\n', 'input.txt': 'base\n' });
    const actor = yield* fixture.born();
    const peer = yield* fixture.born();
    yield* fixture.write(peer.threadId, 'input.txt', 'unfinished\n');
    yield* observed(
      fixture,
      actor.threadId,
      `bun -e "await Bun.write('artifact.txt', 'program\\nshared\\n'); await Bun.write('artifact.bin', new Uint8Array([0, 1, 2]))"`,
    );
    expect(
      yield* fixture.doors.atNative(
        'submit_work',
        {
          subject: 'land a program-written binary',
          paths: ['artifact.bin'],
          tasks: [],
        },
        actor,
      ),
    ).toMatchObject({ class: 'refusal', code: 'derive-required' });
    yield* fixture.write(actor.threadId, 'artifact.txt', 'program\nshared\ntyped\n');
    expect(
      yield* fixture.doors.atNative(
        'submit_work',
        {
          subject: 'land generated content',
          paths: ['artifact.txt'],
          whole: ['artifact.txt'],
          tasks: [],
        },
        actor,
      ),
    ).toMatchObject({ class: 'refusal', code: 'derive-required' });
    expect(yield* fixture.read('artifact.txt')).toBe('base\n');
    expect(yield* fixture.files.readFileString(join(fixture.root, 'artifact.txt'))).toBe('program\nshared\ntyped\n');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('a declared derivation needs no origin marker and drops an output it returns to HEAD without rewriting the working output', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeLanding({
      'artifact.txt': 'base\n',
      'input.txt': 'base\n',
      'peer.txt': 'base\n',
      'tagma.config.ts':
        "export default { derive: { artifact: { paths: ['artifact.txt'], run: ['sh', '-c', 'cat input.txt > artifact.txt'] } } };\n",
    });
    const actor = yield* fixture.born();
    const peer = yield* fixture.born();
    const head = yield* suiteGit(fixture.root, 'rev-parse', 'HEAD');
    yield* fixture.write(peer.threadId, 'peer.txt', 'unfinished\n');
    yield* fixture.write(actor.threadId, 'artifact.txt', 'working output\n');
    expect(
      yield* fixture.doors.atNative(
        'submit_work',
        {
          subject: 'land declared output',
          paths: ['artifact.txt'],
          tasks: [],
        },
        actor,
      ),
    ).toMatchObject({ class: 'answer', value: { submitted: { status: 'nothing' } } });
    expect(yield* suiteGit(fixture.root, 'rev-parse', 'HEAD')).toBe(head);
    expect(yield* fixture.files.readFileString(join(fixture.root, 'artifact.txt'))).toBe('working output\n');
    expect(yield* fixture.files.readFileString(join(fixture.root, 'peer.txt'))).toBe('unfinished\n');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live(
  'derivation output capture ignores generator staging and graph writes, keeps caller precedence and discovers first glob outputs',
  () =>
    Effect.gen(function* () {
      const declaration = {
        derive: {
          others: {
            paths: ['a.out', 'b.out', '.tagma/**'],
            run: [
              'sh',
              '-c',
              'printf wrong > a.out; printf config > b.out; printf wrong > side.txt; printf wrong > .tagma/owned.txt; git add side.txt .tagma',
            ],
          },
          fresh: { paths: ['*.new.ts'], run: ['sh', '-c', 'printf fresh > first.new.ts'] },
        },
      };
      const fixture = yield* nativeLanding({
        'a.out': 'base\n',
        'b.out': 'base\n',
        'side.txt': 'base\n',
        '.tagma/owned.txt': 'graph\n',
        'input.txt': 'base\n',
        'peer.txt': 'base\n',
        'tagma.config.ts': `export default ${JSON.stringify(declaration)};\n`,
      });
      const actor = yield* fixture.born();
      const peer = yield* fixture.born();
      yield* fixture.write(actor.threadId, 'input.txt', 'mine\n');
      yield* fixture.write(peer.threadId, 'peer.txt', 'unfinished\n');
      expect(
        yield* fixture.doors.atNative(
          'submit_work',
          {
            subject: 'derive only declared outputs',
            paths: ['input.txt'],
            derive: [{ paths: ['a.out'], run: ['sh', '-c', 'printf caller > a.out'] }],
            tasks: [],
          },
          actor,
        ),
      ).toMatchObject({ class: 'answer', value: { submitted: { status: 'landed' } } });
      expect(yield* fixture.read('a.out')).toBe('caller');
      expect(yield* fixture.read('b.out')).toBe('config');
      expect(yield* fixture.read('first.new.ts')).toBe('fresh');
      expect(yield* fixture.read('side.txt')).toBe('base\n');
      expect(yield* fixture.read('.tagma/owned.txt')).toBe('graph\n');
      expect(yield* fixture.files.readFileString(join(fixture.root, 'a.out'))).toBe('base\n');
      expect(yield* fixture.files.exists(join(fixture.root, 'first.new.ts'))).toBe(false);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);

it.live('an external partial selection keeps opaque program origin after an excluded peer prefix shifts its line numbers', () =>
  Effect.gen(function* () {
    const fixture = yield* nativeLanding({ 'artifact.txt': 'top\nmiddle\nbottom\n' });
    const actor = yield* fixture.born();
    const peer = yield* fixture.born();
    yield* fixture.write(peer.threadId, 'artifact.txt', 'peer\ntop\nmiddle\nbottom\n');
    yield* observed(fixture, actor.threadId, `bun -e "require('node:fs').appendFileSync('artifact.txt', 'program\\n')"`);
    const refused = yield* fixture.world.op(
      'submit_work',
      { subject: 'land external output', paths: ['artifact.txt'], tasks: [] },
      `project=${fixture.projectId}`,
    );
    expect(refused.body).toMatchObject({ code: 'derive-required' });
    expect(yield* fixture.read('artifact.txt')).toBe('top\nmiddle\nbottom\n');
    expect(yield* fixture.files.readFileString(join(fixture.root, 'artifact.txt'))).toBe('peer\ntop\nmiddle\nbottom\nprogram\n');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
