import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Layer } from 'effect';
import { join } from 'node:path';
import { doorFixture } from '../doorFixture.js';
import { git } from '../threadDoors.js';
import { nativeLanding } from '../landing/native.js';

const SOURCE = 'export const value = 1;\n';
const MARKER = 'export const marker = 1;\n';
const PATHS = ['src/value.ts', 'packages/code-facts/src/marker.ts'];
const REPOSITORY = join(import.meta.dir, '../../../../../../..');
const params = { region: ['src/'], sources: [], rows: [], allow: { request: [], ask: [], row: [] }, aliases: [] };
const setup = Effect.gen(function* () {
  const fixture = yield* nativeLanding(
    {
      '.gitignore': 'node_modules/\n',
      'src/value.ts': SOURCE,
      'packages/code-facts/src/marker.ts': MARKER,
      'tagma.config.ts': `export default ${JSON.stringify({ inspections: { calls: { program: 'checks/law/programs.ts', name: 'ask-calls', concern: 'code', params, files: ['**/*.ts'] } } })};\n`,
    },
    { tools: ['check_rules', 'submit_work'] },
  );
  yield* fixture.files.makeDirectory(join(fixture.root, 'checks'), { recursive: true });
  yield* fixture.files.copy(join(REPOSITORY, 'checks/law'), join(fixture.root, 'checks/law'));
  yield* fixture.files.symlink(join(REPOSITORY, 'node_modules'), join(fixture.root, 'node_modules'));
  const storage = 'apps/tagma/server/src/platform/store';
  yield* fixture.files.makeDirectory(join(fixture.root, storage), { recursive: true });
  yield* fixture.files.symlink(join(REPOSITORY, 'apps/tagma/server/node_modules'), join(fixture.root, 'apps/tagma/server/node_modules'));
  for (const file of ['migrationLaw.ts', 'statementTarget.ts'])
    yield* fixture.files.copy(join(REPOSITORY, storage, file), join(fixture.root, storage, file));
  yield* git(fixture.root, 'add', 'checks/law', storage);
  yield* git(fixture.root, 'commit', '-qm', 'install the real law program');
  return fixture;
}).pipe(Effect.provide(BunFileSystem.layer));

class InspectionState extends Context.Service<InspectionState, Effect.Success<typeof setup>>()('testing/InspectionState') {}

layer(Layer.effect(InspectionState, setup).pipe(Layer.provide(doorFixture()), Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('inspection state', (it) => {
  it.effect('a completed candidate preparation remains visible when a peer changes only the working reader source', () =>
    Effect.gen(function* () {
      const { world, files, root, projectId, born, doors, write, read } = yield* InspectionState;
      const project = `project=${projectId}`;
      const roots = yield* world.op('list_root_blocks', {}, project);
      const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
      const created = yield* world.op(
        'create_block',
        { parentId, tags: ['rule'], title: 'Keep calls inside their allowed region' },
        project,
      );
      const blockId = (created.body as { block: { name: string } }).block.name;
      expect(
        yield* world.op(
          'enforce_rule',
          { blockId, base: null, inspection: 'calls', strictness: 'gate', on: [{ op: 'submit_work', phase: 'before' }] },
          project,
        ),
      ).toMatchObject({ status: 200 });
      const actor = yield* born();
      yield* write(actor.threadId, PATHS[0]!, SOURCE.replace('1', '2'));
      yield* write(actor.threadId, PATHS[1]!, MARKER.replace('1', '2'));
      expect(yield* doors.atNative('check_rules', { inspection: 'calls', over: 'change', paths: PATHS, limit: 10 }, actor)).toMatchObject({
        class: 'answer',
        value: { refuses: false, violations: [] },
      });
      const reader = join(root, 'checks/law/declarations/facts.ts');
      yield* files.writeFileString(reader, `${yield* files.readFileString(reader)}\n`);
      expect(yield* doors.atNative('submit_work', { paths: PATHS, subject: 'candidate after preparation' }, actor)).toMatchObject({
        class: 'answer',
        value: { submitted: { status: 'landed', committed: [...PATHS].sort() } },
      });
      expect(yield* read(PATHS[0]!)).toBe(SOURCE.replace('1', '2'));
      expect(yield* read(PATHS[1]!)).toBe(MARKER.replace('1', '2'));
    }),
  );
});
