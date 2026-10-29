import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Queue, Schema } from 'effect';
import { GraphFeed, type GraphFrame } from '../../../graph/contract/service/journal.js';
import type { EnforcementReading } from '../../../enforcement/contract/wire/engines.js';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import type { CoveredRepositoriesAnswer } from '../../../workspace/contract/wire/repositories.js';
import { makeThreadDoors } from '../threadDoors.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';
import { lineWrites } from '../../lineWrites.js';

const CLEAN = 'export const value = 1;\n';
const CROSSING = 'export const first = 1;\nexport const second = 2;\n';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('checkout debt', (it) => {
  it.effect('an immediate native merge delivers worktree debt with a history step and preserves the changed base graph', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const homeRoot = yield* world.directory('home');
      const home = yield* world.stealthProject(homeRoot);
      yield* suiteGit(homeRoot, 'commit', '--allow-empty', '-qm', 'home seed');
      const root = yield* files.realPath(yield* world.directory('target'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, 'budget.ts'), CLEAN);
      for (const name of ['first', 'second', 'retired']) yield* files.writeFileString(join(root, `${name}.ts`), CROSSING);
      yield* files.writeFileString(
        join(root, 'tagma.config.ts'),
        `export default ${JSON.stringify({ inspections: { small: { builtin: 'size', params: { base: '', files: { extensions: ['.ts'], exclude: ['tagma.config.ts'] }, thresholds: [{ glob: '**', metric: 'non-import', lines: 1 }] } } } })};\n`,
      );
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'seed');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'team' });
      expect(added.status).toBe(200);
      const target = (added.body as { project: { id: number } }).project.id;
      const op = (id: string, input: unknown, cwd = root) => world.op(id, input, `project=${target}&cwd=${encodeURIComponent(cwd)}`);
      expect(yield* op('write_setting', { key: 'graph.commit', value: 'manual' })).toMatchObject({ status: 200 });
      const rootName = ((yield* op('list_root_blocks', {})).body as { blocks: { name: string }[] }).blocks[0]!.name;
      const madeRule = yield* op('create_block', {
        tags: ['rule'],
        parentId: rootName,
        title: 'Keep source files within their line budget',
      });
      const rule = (madeRule.body as { block: { name: string } }).block.name;
      const initialOwner = yield* op('create_block', { tags: ['task'], parentId: rule, title: 'Shorten existing files' });
      expect(initialOwner.status).toBe(200);
      const initialOwnerName = (initialOwner.body as { block: { name: string } }).block.name;
      const enforced = yield* op('enforce_rule', {
        blockId: rule,
        base: null,
        strictness: 'gate',
        inspection: 'small',
        owner: initialOwnerName,
        on: [
          { op: 'submit_work', phase: 'before' },
          { op: 'merge_worktree', phase: 'before' },
        ],
      });
      expect(enforced.status).toBe(200);
      const base = (enforced.body as { revision: string }).revision;
      const frames = yield* Queue.unbounded<GraphFrame>();
      const served = yield* world.runtime.pool.resolve({ projectId: target });
      yield* Effect.acquireRelease(
        Context.get(served.context, GraphFeed).subscribe(target, (frame) => {
          Queue.offerUnsafe(frames, frame);
        }),
        (stop) => Effect.sync(stop),
      );
      expect(yield* op('sync_graph', {})).toMatchObject({ status: 200 });
      yield* files.remove(join(root, 'retired.ts'));
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'retire one debt entry');
      const reading = () =>
        Effect.map(
          Effect.suspend(() => op('read_enforcement', { rule, limit: 3 })),
          (answer) => answer.body as EnforcementReading,
        );
      const before = yield* Effect.gen(function* () {
        for (;;) {
          const answer = yield* reading();
          if (answer.engine?.row.debt.count === 2) return answer;
          yield* Queue.take(frames);
        }
      });
      expect(before.engine?.history.map((point) => point.count)).toEqual([2, 3]);
      expect(before.engine?.row.debt.was).toMatchObject({ count: 3 });
      expect(yield* op('sync_graph', {})).toMatchObject({ status: 200 });
      yield* Context.get(world.runtime.workspace, Coverage).cover(target);
      const listed = (yield* op('read_repositories', {})).body as CoveredRepositoriesAnswer;
      const destination = join(yield* files.realPath(yield* world.directory('worktrees')), 'absorb');
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${home}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
      const doors = makeThreadDoors(world, home, ['enforce_rule', 'create_block', 'submit_work', 'merge_worktree', 'read_enforcement']);
      const native = yield* doors.doorsFor(thread.id, thread.ownerId);
      const byThread = (id: string, input: Record<string, unknown>) => doors.atNative(id, { project: target, ...input }, native);
      expect(
        yield* op('prepare_worktree', {
          operationId: 'absorb',
          repository: listed.repositories[0]!.binding,
          destination,
          mode: { kind: 'new-branch', branch: 'absorb', start: 'HEAD' },
        }),
      ).toMatchObject({ status: 200 });
      const created = yield* op('create_worktree', { operationId: 'absorb' });
      expect(created.status).toBe(200);
      const rootId = (created.body as { operation: { rootId: string } }).operation.rootId;
      const madeOwner = yield* byThread('create_block', {
        checkout: destination,
        parentId: rule,
        tags: ['task'],
        title: 'Shorten the budget file',
      });
      expect(madeOwner).toMatchObject({ class: 'answer', value: { graphCopy: { checkout: destination } } });
      if (madeOwner.class !== 'answer') return yield* Effect.die(new Error(`owner creation refused: ${madeOwner.code}`));
      const owner = (madeOwner.value as { block: { name: string } }).block.name;
      expect(yield* op('sync_graph', {}, destination)).toMatchObject({ status: 200 });
      const debtHead = yield* suiteGit(destination, 'rev-parse', 'HEAD');
      const later = yield* op('create_block', {
        tags: ['task'],
        parentId: rootName,
        title: 'A task main wrote after the branch parted',
      });
      expect(later.status).toBe(200);
      const mainOwner = (later.body as { block: { name: string } }).block.name;
      expect(yield* op('sync_graph', {})).toMatchObject({ status: 200 });
      const path = join(destination, 'budget.ts');
      expect(
        yield* Context.get(world.runtime.owners, ChangeRecord).land(
          { work: { projectId: home, threadId: thread.id } },
          [
            {
              path,
              origin: 'edit',
              before: contentDigest(CLEAN),
              after: contentDigest(CROSSING),
              beforeText: CLEAN,
              afterText: CROSSING,
              hunk: workspaceChangeHunk(CLEAN, CROSSING),
              at: new Date(yield* Clock.currentTimeMillis),
            },
          ],
          lineWrites.replace({ root: destination, path: 'budget.ts', before: CLEAN, after: CROSSING }, Effect.succeed(true)),
        ),
      ).toEqual({ _tag: 'written', kept: true });
      const fingerprint = 'budget.ts';
      const absorbed = yield* byThread('enforce_rule', {
        checkout: destination,
        blockId: rule,
        base,
        strictness: 'gate',
        absorb: [fingerprint],
        owner,
      });
      expect(absorbed).toMatchObject({
        class: 'answer',
        value: {
          head: debtHead,
          graph: join(destination, '.tagma'),
          absorbed: [{ fingerprint, owner, held: { base: debtHead, path: 'budget.ts' } }],
        },
      });
      expect(yield* suiteGit(destination, 'status', '--porcelain', '--', '.tagma')).not.toBe('');
      expect(yield* byThread('submit_work', { checkout: destination, subject: 'add budget entry' })).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['budget.ts'] } },
      });
      const merged = yield* byThread('merge_worktree', { rootId });
      expect(merged).toMatchObject({ class: 'answer', value: { status: 'merged' } });
      expect(yield* files.readFileString(join(root, 'budget.ts'))).toBe(CROSSING);
      const read = yield* byThread('read_enforcement', { rule, limit: 3 });
      expect(read.class).toBe('answer');
      if (read.class !== 'answer') return yield* Effect.die(new Error(`main history reading refused: ${read.code}`));
      const after = read.value as EnforcementReading;
      expect(after.debt?.total).toBe(3);
      expect(after.debt?.rows).toEqual(expect.arrayContaining([expect.objectContaining({ fingerprint, owner })]));
      expect(after.escaped).toMatchObject({ total: 0, rows: [] });
      expect(after.engine?.history.slice(1)).toEqual([...(before.engine?.history ?? [])]);
      expect(after.engine?.history[0]).toMatchObject({ count: 3 });
      expect((after.engine?.history[0]?.at ?? '') > (before.engine?.history[0]?.at ?? '')).toBe(true);
      expect(after.engine?.row.debt.was).toEqual({ count: 2, until: after.engine?.history[0]?.at ?? '' });
      expect(yield* op('search_blocks', { query: owner, limit: 1 })).toMatchObject({
        status: 200,
        body: { total: 1, blocks: [{ name: owner }] },
      });
      expect(yield* op('search_blocks', { query: mainOwner, limit: 1 }, destination)).toMatchObject({
        status: 200,
        body: { total: 1, blocks: [{ name: mainOwner }] },
      });
      expect(
        yield* byThread('create_block', {
          checkout: destination,
          parentId: rootName,
          tags: ['task'],
          title: 'Pending work after the merge',
        }),
      ).toMatchObject({
        class: 'answer',
      });
      expect(yield* op('write_setting', { key: 'graph.commit', value: 'off' })).toMatchObject({ status: 200 });
      const tips = [yield* suiteGit(root, 'rev-parse', 'HEAD'), yield* suiteGit(destination, 'rev-parse', 'HEAD')];
      expect(yield* byThread('merge_worktree', { rootId })).toMatchObject({ class: 'refusal', code: 'source-dirty' });
      expect([yield* suiteGit(root, 'rev-parse', 'HEAD'), yield* suiteGit(destination, 'rev-parse', 'HEAD')]).toEqual(tips);
    }),
  );
});
