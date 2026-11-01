import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Queue, Schema } from 'effect';
import { GraphFeed } from '../../../graph/contract/service/journal.js';
import { CommandReader } from '../../../executions/contract/service/commands.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { EnforcementReading } from '../../../enforcement/contract/wire/engines.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { seedRepository } from './native.js';

const INSPECTIONS = {
  clean: { program: 'tools/check.js', name: 'clean', concern: 'code', params: {} },
  marked: { program: 'tools/check.js', name: 'marked', concern: 'code', params: {} },
};
const PROGRAM = `const findings = async (tree, marker) => (await Promise.all(tree.paths.map(async (path) => {
  const text = (await tree.read(path)) ?? '';
  return path.startsWith('src/') && text.includes(marker)
    ? [{ fingerprint: path, path, line: 1, message: marker }]
    : [];
}))).flat();
export default {
  clean: async ({ tree }) => ({ tree: { findings: await findings(tree, 'FORBIDDEN') } }),
  marked: async ({ tree }) => ({ tree: { findings: await findings(tree, 'MARKED') } }),
};
`;

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const files = yield* FileSystem.FileSystem;
  const home = yield* world.stealthProject();
  const root = yield* files.realPath(yield* world.directory('merge-project'));
  yield* seedRepository(root);
  yield* files.makeDirectory(join(root, 'tools'));
  yield* files.makeDirectory(join(root, 'src'));
  yield* files.writeFileString(join(root, 'tagma.config.ts'), `export default ${JSON.stringify({ inspections: INSPECTIONS })};\n`);
  yield* files.writeFileString(join(root, 'tools/check.js'), PROGRAM);
  yield* files.writeFileString(join(root, 'src/base.ts'), 'export const base = 1;\n');
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-qm', 'seed');
  const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
  expect(added.status).toBe(200);
  const target = (added.body as { project: { id: number } }).project.id;
  expect(yield* world.op('write_setting', { project: target, key: 'graph.commit', value: 'manual' }, `project=${target}`)).toMatchObject({
    status: 200,
  });
  yield* Context.get(world.runtime.workspace, Coverage).cover(target);
  const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${home}`);
  expect(born.status).toBe(200);
  const {
    snapshot: { thread },
  } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
  const grant = grantEnvironment(thread.id, testSessionIdentity)[GRANT_VARIABLE]!;
  const op = (id: string, input: unknown, asThread = false) =>
    world.op(id, input, `project=${target}`, asThread ? { [GRANT_HEADER]: grant } : undefined);
  let after = '';
  for (const [inspection, strictness, phase] of [
    ['clean', 'gate', 'before'],
    ['marked', 'watch', 'after'],
  ] as const) {
    const parentId = ((yield* op('list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
    const created = yield* op('create_block', { tags: ['rule'], title: `The ${inspection} rule`, parentId });
    expect(created.status).toBe(200);
    const rule = (created.body as { block: { name: string } }).block.name;
    expect(
      yield* op('enforce_rule', {
        blockId: rule,
        base: null,
        strictness,
        inspection,
        on: [{ op: 'merge_worktree', phase }],
      }),
    ).toMatchObject({ status: 200 });
    if (phase === 'after') after = rule;
  }
  yield* suiteGit(root, 'add', '-A');
  yield* suiteGit(root, 'commit', '-qm', 'merge law');
  const repositories = (yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer;
  const changes = yield* Queue.unbounded<void>();
  const served = yield* world.runtime.pool.resolve({ projectId: target });
  yield* Effect.acquireRelease(
    Context.get(served.context, GraphFeed).subscribe(target, () => {
      Queue.offerUnsafe(changes, undefined);
    }),
    (stop) => Effect.sync(stop),
  );
  const enforcementWhen = Effect.fnUntraced(function* (count: number) {
    for (;;) {
      const reading = (yield* op('read_enforcement', { rule: after, limit: 2 })).body as EnforcementReading;
      if (reading.engine?.row.escaped === count) return reading;
      yield* Queue.take(changes);
    }
  });
  return {
    world,
    root,
    home,
    target,
    thread: ThreadId.make(thread.id),
    op,
    after,
    enforcementWhen,
    repository: repositories.repositories[0]!.binding,
  };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/MergeHome') {}

layer(Layer.effect(Place, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('merge from another home', (it) => {
  it.effect('immediate and queued merges run their before and after programs as the calling thread in its home', () =>
    Effect.gen(function* () {
      const { world, root, home, target, thread, op, enforcementWhen, repository } = yield* Place;
      const files = yield* FileSystem.FileSystem;
      for (const [index, name] of ['immediate', 'queued'].entries()) {
        const destination = join(yield* files.realPath(yield* world.directory('worktrees')), name);
        expect(
          yield* op('prepare_worktree', {
            operationId: name,
            repository,
            destination,
            mode: { kind: 'new-branch', branch: name, start: 'HEAD' },
          }),
        ).toMatchObject({ status: 200 });
        const created = yield* op('create_worktree', { operationId: name });
        expect(created.status).toBe(200);
        const rootId = (created.body as { operation: { rootId: string } }).operation.rootId;
        yield* files.writeFileString(join(destination, 'src', `${name}.ts`), 'export const value = "MARKED";\n');
        yield* suiteGit(destination, 'add', '-A');
        yield* suiteGit(destination, 'commit', '-qm', name);
        if (name === 'queued') {
          yield* files.writeFileString(join(root, 'src', 'queued.ts'), 'staged work\n');
          yield* suiteGit(root, 'add', 'src/queued.ts');
        }
        const input = { rootId, whenBaseFree: name === 'queued' };
        let merged = yield* op('merge_worktree', input, true);
        if (merged.status === 409 && (merged.body as { code: string }).code === 'instructions-unread') {
          merged = yield* op('merge_worktree', input, true);
        }
        expect(merged).toMatchObject({ status: 200, body: { status: name === 'queued' ? 'queued' : 'merged' } });
        if (name === 'queued') {
          yield* suiteGit(root, 'restore', '--staged', 'src/queued.ts');
          yield* files.remove(join(root, 'src', 'queued.ts'));
        }
        const reading = yield* enforcementWhen(index + 1);
        expect(reading.escaped?.rows.map((escape) => escape.path).sort()).toEqual(
          ['immediate', 'queued']
            .slice(0, index + 1)
            .map((one) => `src/${one}.ts`)
            .sort(),
        );
        expect(yield* files.readFileString(join(root, 'src', `${name}.ts`))).toBe('export const value = "MARKED";\n');
      }
      const reader = Context.get(world.runtime.executions, CommandReader);
      const owned = yield* reader.page(home, { owner: { _tag: 'Thread', thread }, limit: 10 });
      expect(owned.readings.length).toBeGreaterThan(0);
      expect(new Set(owned.readings.map(({ command }) => command.projectId))).toEqual(new Set([home]));
      expect((yield* reader.page(target, { owner: { _tag: 'Thread', thread }, limit: 1 })).readings).toEqual([]);
    }),
  );
});
