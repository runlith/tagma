import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { WORK_OPERATIONS } from '../../../graph/contract/wire/operations/work.js';
import { lineWrites } from '../../lineWrites.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { makeThreadDoors, type Outcome } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';

const BEFORE = 'export const rate = 1;\nexport const old = 2;\n';
const AFTER = 'export const rate = 1;\n';
const ended = Schema.decodeUnknownEffect(knownAnswer(WORK_OPERATIONS.finish_block.answer));

const answered = (outcome: Outcome): Record<string, unknown> => {
  expect(outcome.class, outcome.class === 'refusal' ? `${outcome.code}: ${outcome.unblock.join('; ')}` : '').toBe('answer');
  return (outcome.class === 'answer' ? outcome.value : {}) as Record<string, unknown>;
};

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('finishing landed debt', (it) => {
  it.effect('a foreign thread lands a debt fix and immediately finishes its owner without reporting the removed entry', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const homeRoot = yield* world.directory('home');
      yield* suiteGit(homeRoot, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(homeRoot, 'seed.ts'), AFTER);
      yield* suiteGit(homeRoot, 'add', 'seed.ts');
      yield* suiteGit(homeRoot, 'commit', '-qm', 'home seed');
      const madeHome = yield* world.op('add_project', { name: world.uniqueName(), rootPath: homeRoot, storage: 'stealth', catalogs: [] });
      expect(madeHome.status).toBe(200);
      const home = (madeHome.body as { project: { id: number } }).project.id;
      const root = yield* files.realPath(yield* world.directory('target'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, 'rates.ts'), BEFORE);
      yield* files.writeFileString(join(root, 'other.ts'), BEFORE);
      yield* files.writeFileString(
        join(root, 'tagma.config.ts'),
        `export default ${JSON.stringify({
          inspections: {
            small: {
              builtin: 'size',
              params: {
                base: '',
                files: { extensions: ['.ts'], exclude: ['tagma.config.ts'] },
                thresholds: [{ glob: '**', metric: 'non-import', lines: 1 }],
              },
            },
          },
        })};\n`,
      );
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'seed debt');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
      expect(added.status).toBe(200);
      const project = (added.body as { project: { id: number } }).project.id;
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${home}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
      const doors = makeThreadDoors(world, home, ['create_block', 'claim_block', 'enforce_rule', 'submit_work', 'finish_block']);
      const native = yield* doors.doorsFor(thread.id, thread.ownerId);
      const call = (id: string, input: Record<string, unknown>) => doors.atNative(id, { project, ...input }, native);
      const owner = (
        answered(yield* call('create_block', { tags: ['task'], title: 'Shorten rates', claim: true })).block as { name: string }
      ).name;
      const rule = (answered(yield* call('create_block', { tags: ['rule'], title: 'Small files' })).block as { name: string }).name;
      expect(
        answered(
          yield* call('enforce_rule', {
            blockId: rule,
            base: null,
            strictness: 'gate',
            inspection: 'small',
            owner,
            on: [{ op: 'submit_work', phase: 'before' }],
          }),
        ),
      ).toMatchObject({ debt: { after: 2 } });
      expect(
        yield* Context.get(world.runtime.owners, ChangeRecord).land(
          { work: { projectId: home, threadId: thread.id } },
          [
            {
              path: join(root, 'rates.ts'),
              origin: 'edit',
              before: contentDigest(BEFORE),
              after: contentDigest(AFTER),
              beforeText: BEFORE,
              afterText: AFTER,
              hunk: workspaceChangeHunk(BEFORE, AFTER),
              at: new Date(yield* Clock.currentTimeMillis),
            },
          ],
          lineWrites.replace({ root, path: 'rates.ts', before: BEFORE, after: AFTER }, Effect.succeed(true)),
        ),
      ).toEqual({ _tag: 'written', kept: true });
      const landing = answered(yield* call('submit_work', { subject: 'shorten rates' }));
      expect(landing).toMatchObject({ submitted: { status: 'landed', committed: ['rates.ts'] } });
      const commit = (landing.submitted as { commit: string }).commit;
      const answer = yield* ended(answered(yield* call('finish_block', { blockId: owner, commit })));
      expect(answer.block.fields.status).toBe('done');
      expect(answer.debt?.map(({ rule, entries }) => ({ rule, entries }))).toEqual([{ rule, entries: 1 }]);
      expect(answer.debtUnreadable).toBeUndefined();
    }),
  );
});
