import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { join } from 'node:path';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { lineWrites } from '../../lineWrites.js';
import { doorFixture } from '../doorFixture.js';
import { git } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';
import { nativeLanding } from './native.js';

const CONFIG = "import { format } from './tools/format';\nexport default { format };\n";
const MAIN = "export const format = { main: { run: ['false'], files: ['value.ts'] } };\n";
const SIDE = "export const format = { side: { run: ['sh', 'format.sh'], files: ['value.ts'] } };\n";
const BEFORE = 'export const value = 1;\n';
const AFTER = 'export const value = 2;\n';

const setup = nativeLanding(
  {
    'value.ts': BEFORE,
    'tagma.config.ts': CONFIG,
    'tools/format.ts': MAIN,
    'format.sh': 'for file in "$@"; do tr -d ";" < "$file" > "$file.next" && mv "$file.next" "$file"; done\n',
  },
  { tools: ['read_config', 'submit_work'] },
).pipe(Effect.provide(BunFileSystem.layer));

class Landing extends Context.Service<Landing, Effect.Success<typeof setup>>()('testing/VersionedConfig') {}

layer(Layer.effect(Landing, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('versioned config', (it) => {
  it.effect('native worktree landing reads its own complete tracked config despite empty working files and a cached main declaration', () =>
    Effect.gen(function* () {
      const { world, files, root, projectId, doors } = yield* Landing;
      const created = yield* world.op('create_thread', { approvalMode: 'trust' }, `project=${projectId}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(created.body);
      const actor = yield* doors.doorsFor(thread.id, thread.ownerId);
      expect(yield* doors.atNative('read_config', {}, actor)).toMatchObject({
        class: 'answer',
        value: { config: { format: [{ key: 'main', run: ['false'] }] } },
      });
      const mainHead = yield* suiteGit(root, 'rev-parse', 'HEAD');
      const side = yield* files.realPath(yield* world.directory('side'));
      yield* git(root, 'worktree', 'add', '-q', '-b', 'side', side);
      const covered = yield* Context.get(world.runtime.workspace, Coverage).adopt(projectId, side);
      yield* files.writeFileString(join(side, 'tools/format.ts'), SIDE);
      yield* git(side, 'add', 'tools/format.ts');
      yield* git(side, 'commit', '-qm', 'side format declaration');
      expect(yield* world.op('move_thread', { threadId: actor.threadId, worktree: covered.rootId }, `project=${projectId}`)).toMatchObject({
        status: 200,
      });
      const placed = yield* doors.doorsFor(thread.id, thread.ownerId);
      yield* files.writeFileString(join(root, 'tagma.config.ts'), '');
      yield* files.writeFileString(join(side, 'tagma.config.ts'), '');
      yield* files.writeFileString(join(side, 'tools/format.ts'), 'export const format = {');
      expect(
        yield* Context.get(world.runtime.owners, ChangeRecord).land(
          { work: { projectId, threadId: actor.threadId } },
          [
            {
              path: join(side, 'value.ts'),
              origin: 'edit',
              before: contentDigest(BEFORE),
              after: contentDigest(AFTER),
              beforeText: BEFORE,
              afterText: AFTER,
              hunk: workspaceChangeHunk(BEFORE, AFTER),
              at: new Date(yield* Clock.currentTimeMillis),
            },
          ],
          lineWrites.replace({ root: side, path: 'value.ts', before: BEFORE, after: AFTER }, Effect.succeed(true)),
        ),
      ).toMatchObject({ _tag: 'written', kept: true });
      expect(yield* doors.atNative('submit_work', { subject: 'land side value', paths: ['value.ts'] }, placed)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: ['value.ts'] } },
      });
      expect(yield* suiteGit(side, 'show', 'HEAD:value.ts')).toBe('export const value = 2');
      expect(yield* files.readFileString(join(side, 'value.ts'))).toBe('export const value = 2\n');
      expect(yield* suiteGit(side, 'show', 'HEAD:tagma.config.ts')).toBe(CONFIG.trim());
      expect(yield* suiteGit(side, 'show', 'HEAD:tools/format.ts')).toBe(SIDE.trim());
      expect(yield* suiteGit(root, 'rev-parse', 'HEAD')).toBe(mainHead);
      expect(yield* files.readFileString(join(root, 'tagma.config.ts'))).toBe('');
      expect(yield* files.readFileString(join(side, 'tagma.config.ts'))).toBe('');
      expect(yield* files.readFileString(join(side, 'tools/format.ts'))).toBe('export const format = {');
    }),
  );
});
