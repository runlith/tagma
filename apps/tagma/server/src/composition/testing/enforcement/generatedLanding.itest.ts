import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { lineWrites } from '../../lineWrites.js';
import { join } from 'node:path';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { makeThreadDoors, type Outcome } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';

const answered = (outcome: Outcome): Record<string, unknown> => {
  expect(outcome.class, outcome.class === 'refusal' ? `${outcome.code}: ${outcome.reason}` : '').toBe('answer');
  return (outcome.class === 'answer' ? outcome.value : {}) as Record<string, unknown>;
};

const config = `export default ${JSON.stringify({
  inspections: {
    platforms: {
      builtin: 'platforms',
      params: {
        base: '',
        platforms: { bun: { runtime: 'bun', unmarked: true } },
        shipped: 'bun',
        allows: {},
        refuses: { bun: ['node:fs'] },
        packages: {},
        apps: [],
        programs: [],
        compiled: [],
        leaves: [],
        files: { extensions: ['.ts'], exclude: [] },
        built: [{ output: 'app/.gen/tsconfig.json', source: 'app/kit.json', why: 'The tracked generated config.' }],
      },
    },
  },
})};\n`;

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'generated configs at the landing door',
  (it) => {
    it.effect('a reordered generated config lands semantically, while a stale copy refuses once without attributing source crossings', () =>
      Effect.gen(function* () {
        const world = yield* DoorFixture;
        const files = yield* FileSystem.FileSystem;
        const root = yield* files.realPath(yield* world.directory('generated-landing'));
        const copy = JSON.stringify({ compilerOptions: { paths: { '$lib/*': ['../lib/*'] } }, exclude: [] });
        const generator = 'export default { exclude: [] };\n';
        const own = 'export const own = 1;\n';
        yield* suiteGit(root, 'init', '-q', '-b', 'main');
        yield* files.makeDirectory(join(root, 'app/lib'), { recursive: true });
        for (const [path, text] of Object.entries({
          '.gitignore': 'app/.gen/\n',
          'package.json': JSON.stringify({ private: true, workspaces: ['app'] }),
          'app/package.json': JSON.stringify({ name: 'app', exports: { '.': { bun: './main.ts' } } }),
          'app/tsconfig.json': JSON.stringify({ extends: './.gen/tsconfig.json' }),
          'app/kit.json': copy,
          'app/svelte.config.js': generator,
          'app/main.ts': "import { shared } from '$lib/shared';\nexport const main = shared;\n",
          'app/lib/shared.ts': 'export const shared = 1;\n',
          'own.ts': own,
          'tagma.config.ts': config,
        }))
          yield* files.writeFileString(join(root, path), text);
        yield* suiteGit(root, 'add', '-A');
        yield* suiteGit(root, 'commit', '-qm', 'seed generated config');
        const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
        expect(added.status).toBe(200);
        const project = (added.body as { project: { id: number } }).project.id;
        const born = Effect.fnUntraced(function* () {
          const result = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
          return (yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(result.body)).snapshot.thread;
        });
        const mine = yield* born();
        const peer = yield* born();
        const wrote = Effect.fnUntraced(function* (threadId: string, path: string, before: string, after: string) {
          expect(
            yield* Context.get(world.runtime.owners, ChangeRecord).land(
              { work: { projectId: project, threadId } },
              [
                {
                  path: join(root, path),
                  origin: 'edit',
                  before: contentDigest(before),
                  after: contentDigest(after),
                  beforeText: before,
                  afterText: after,
                  hunk: workspaceChangeHunk(before, after),
                  at: new Date(yield* Clock.currentTimeMillis),
                },
              ],
              lineWrites.replace({ root, path, before, after }, Effect.succeed(true)),
            ),
          ).toEqual({ _tag: 'written', kept: true });
        });
        const doors = makeThreadDoors(world, project, ['create_block', 'enforce_rule', 'check_rules', 'submit_work']);
        const native = yield* doors.doorsFor(mine.id, mine.ownerId);
        yield* doors.doorsFor(peer.id, peer.ownerId);
        const call = (id: string, input: Record<string, unknown>) => doors.atNative(id, input, native);
        const parentId = ((yield* world.op('list_root_blocks', {}, `project=${project}`)).body as { blocks: { name: string }[] }).blocks[0]!
          .name;
        const rule = (
          answered(yield* call('create_block', { tags: ['rule'], parentId, title: 'Load only bun-compatible code' })).block as {
            name: string;
          }
        ).name;
        expect(
          answered(
            yield* call('enforce_rule', {
              blockId: rule,
              base: null,
              strictness: 'gate',
              inspection: 'platforms',
              on: [{ op: 'submit_work', phase: 'before' }],
            }),
          ),
        ).toMatchObject({ debt: { after: 0 } });
        yield* wrote(peer.id, 'app/svelte.config.js', generator, "export default { exclude: ['peer'] };\n");
        yield* files.makeDirectory(join(root, 'app/.gen'), { recursive: true });
        yield* files.writeFileString(
          join(root, 'app/.gen/tsconfig.json'),
          JSON.stringify(
            {
              exclude: [],
              compilerOptions: { paths: { '$lib/*': ['../lib/*'] } },
            },
            null,
            '\t',
          ),
        );
        yield* wrote(mine.id, 'own.ts', own, 'export const own = 2;\n');
        expect(answered(yield* call('check_rules', { over: 'change', paths: ['own.ts'], limit: 10 }))).toMatchObject({ refuses: false });
        expect(answered(yield* call('submit_work', { paths: ['own.ts'], tasks: [], subject: 'change own value' }))).toMatchObject({
          submitted: { status: 'landed' },
        });
        expect(`${yield* suiteGit(root, 'show', 'HEAD:app/svelte.config.js')}\n`).toBe(generator);
        expect(yield* files.readFileString(join(root, 'app/svelte.config.js'))).toContain("['peer']");
        yield* files.writeFileString(
          join(root, 'app/.gen/tsconfig.json'),
          JSON.stringify({
            compilerOptions: { paths: { '$lib/*': ['../lib/*'] } },
            exclude: ['peer'],
          }),
        );
        yield* wrote(mine.id, 'own.ts', 'export const own = 2;\n', 'export const own = 3;\n');
        const stale = yield* call('submit_work', { paths: ['own.ts'], tasks: [], subject: 'change own value again' });
        yield* wrote(
          mine.id,
          'app/main.ts',
          "import { shared } from '$lib/shared';\nexport const main = shared;\n",
          "import { shared } from '$lib/shared';\nexport const main = shared + 1;\n",
        );
        const repairPaths = ['own.ts', 'app/main.ts'];
        const staleCheck = yield* call('check_rules', { over: 'change', paths: repairPaths, limit: 10 });
        yield* files.writeFileString(join(root, 'app/.gen/tsconfig.json'), copy);
        const regenerated = answered(yield* call('check_rules', { over: 'change', paths: repairPaths, limit: 10 }));
        expect(regenerated).toMatchObject({ refuses: false, violations: [] });
        const repeated = answered(yield* call('check_rules', { over: 'change', paths: repairPaths, limit: 10 }));
        expect(repeated).toMatchObject({ refuses: false, violations: [], head: regenerated.head, paths: regenerated.paths });
        expect(stale).toMatchObject({ class: 'refusal', code: 'inspection-failed' });
        expect(answered(staleCheck)).toMatchObject({ refuses: true, rules: [{ failed: expect.any(String) }] });
        if (stale.class === 'refusal') {
          expect(stale.reason).toContain('app/kit.json');
          expect(stale.reason).toContain('app/.gen/tsconfig.json');
        }
        yield* files.writeFileString(
          join(root, 'app/.gen/tsconfig.json'),
          JSON.stringify({
            compilerOptions: { paths: { '$lib/*': ['../lib/*'] } },
            exclude: ['peer'],
          }),
        );
        const aligned = JSON.stringify({ compilerOptions: { paths: { '$lib/*': ['../lib/*'] } }, exclude: ['peer'] });
        yield* wrote(mine.id, 'app/kit.json', copy, aligned);
        expect(
          answered(yield* call('submit_work', { paths: ['app/kit.json'], tasks: [], subject: 'align the generated copy' })),
        ).toMatchObject({ submitted: { status: 'landed' } });
        yield* wrote(mine.id, 'app/lib/shared.ts', 'export const shared = 1;\n', "import 'node:fs';\nexport const shared = 1;\n");
        expect(yield* call('submit_work', { paths: ['app/lib/shared.ts'], tasks: [], subject: 'add a forbidden load' })).toMatchObject({
          class: 'refusal',
          code: 'rule-violated',
        });
      }),
    );
  },
);
