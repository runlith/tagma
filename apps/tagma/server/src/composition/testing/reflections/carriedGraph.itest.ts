import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

const seeded = Effect.fnUntraced(function* (prefix: string) {
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix }));
  yield* suiteGit(root, 'init', '-q', '-b', 'main');
  yield* files.makeDirectory(join(root, 'server'), { recursive: true });
  yield* files.writeFileString(join(root, 'server', 'value.ts'), 'export const value = 1;\n');
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-qm', 'seed');
  return root;
});

it.live("a closure cut from a distribution files a core operation's friction under the core's own module card, born stealth", () =>
  Effect.gen(function* () {
    const distribution = yield* seeded('reflection-distribution-');
    const core = yield* seeded('reflection-core-');
    const world = yield* makeDoorWorld({
      own: 'a closure cut from a distribution that carries the core as a clone',
      installation: {
        version: 1,
        identity: { build: 'distribution 20261102T000000000Z', digest: digestOf(new Uint8Array([1])) },
        origin: { checkout: distribution },
        platform: { os: process.platform, arch: process.arch },
        parts: [{ role: 'server', path: 'bin/server/http.js', kind: 'file', bytes: 1, digest: digestOf(new Uint8Array([2])) }],
      },
      codePath: join(distribution, 'core', 'server'),
    });
    const added = Effect.fnUntraced(function* (rootPath: string) {
      const answer = yield* world.op('add_project', { name: world.uniqueName(), rootPath, storage: 'team' });
      expect(answer.status).toBe(200);
      const id = (answer.body as { project: { id: number } }).project.id;
      yield* projectLeaving(world, id);
      return id;
    });
    const shipped = yield* added(distribution);
    const kept = yield* added(core);
    const roots = yield* world.op('list_root_blocks', {}, `project=${kept}`);
    const parent = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
    const module = yield* world.op(
      'set_module',
      { modules: [{ id: 'landing', title: 'Work landing', parent, root: 'server' }] },
      `project=${kept}`,
    );
    expect(module.status).toBe(200);
    const card = (module.body as { modules: { card: string }[] }).modules[0]!.card;
    expect((yield* world.op('sync_graph', {}, `project=${kept}`)).status).toBe(200);
    yield* suiteGit(distribution, 'clone', '-q', core, 'core');
    const filed = yield* world.op(
      'file_reflection',
      {
        title: 'a landing names a committed path as held',
        command: 'submit_work {"paths":["server/value.ts"]}',
        expected: 'the path is reported landed',
        actual: 'it is reported still held',
      },
      `project=${shipped}`,
    );
    expect(filed.status).toBe(200);
    const name = (filed.body as { block: { name: string } }).block.name;
    expect(yield* world.op('read_block', { blockIds: [`${kept}/${name}`] }, `project=${kept}`)).toMatchObject({
      status: 200,
      body: { reads: [{ projectId: kept, parentName: card, stealth: true }] },
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
