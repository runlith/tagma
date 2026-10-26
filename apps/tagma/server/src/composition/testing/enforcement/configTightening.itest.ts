import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem, Layer, Queue, Schema } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { GraphFeed, type GraphFrame } from '../../../graph/contract/service/journal.js';
import { threadWireSnapshotPayloadSchema } from '../../../threads/contract/wire/snapshot.js';
import { lineWrites } from '../../lineWrites.js';
import type { WorkOrigin } from '../../../workspace/contract/wire/place.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { makeThreadDoors, type Outcome } from '../threadDoors.js';
import { suiteGit } from '../suiteGit.js';

const config = (lines: number) =>
  `export default ${JSON.stringify({
    inspections: {
      size: {
        builtin: 'size',
        params: { base: 'src', files: { extensions: ['.ts'], exclude: [] }, thresholds: [{ glob: '**', metric: 'non-import', lines }] },
      },
    },
  })};\n`;

const rows = (count: number) => Array.from({ length: count }, (_, at) => `export const row${at} = ${at};`).join('\n') + '\n';

const wrote = Effect.fnUntraced(function* (
  world: DoorFixture['Service'],
  work: WorkOrigin,
  root: string,
  path: string,
  before: string,
  after: string,
) {
  expect(
    yield* Context.get(world.runtime.owners, ChangeRecord).land(
      { work },
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

const answered = (outcome: Outcome): Record<string, unknown> => {
  expect(outcome.class, outcome.class === 'refusal' ? `${outcome.code}: ${outcome.reason ?? ''}; ${outcome.unblock.join('; ')}` : '').toBe(
    'answer',
  );
  return (outcome.class === 'answer' ? outcome.value : {}) as Record<string, unknown>;
};

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
  testTimeout: 60_000,
  timeout: '60 seconds',
})('uncommitted inspection descriptions', (it) => {
  it.effect('a thread previews the whole tightened reach, lands its warnings and reads their commit as escape origin', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('tightening'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.makeDirectory(join(root, 'src'));
      for (const [path, lines] of [
        ['debt.ts', 6],
        ['seed.ts', 4],
        ['expenses.ts', 4],
        ['small.ts', 2],
      ] as const) {
        yield* files.writeFileString(join(root, 'src', path), rows(lines));
      }
      yield* files.writeFileString(
        join(root, 'inspect.js'),
        `const found = (side) => side.paths.includes('src/small.ts') ? [1, 2].map((line) => ({ fingerprint: 'shared', path: 'src/small.ts', line, message: 'A repeated unit' })) : [];
export default { repeated: ({ tree, base }) => ({ tree: { findings: found(tree) }, base: base === null ? undefined : { findings: found(base) } }) };\n`,
      );
      yield* files.writeFileString(join(root, 'tagma.config.ts'), config(5));
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'seed size rule');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
      expect(added.status).toBe(200);
      const project = (added.body as { project: { id: number } }).project.id;
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
      const doors = makeThreadDoors(world, project, ['create_block', 'enforce_rule', 'check_rules', 'submit_work', 'read_enforcement']);
      const native = yield* doors.doorsFor(thread.id, thread.ownerId);
      const call = (id: string, input: Record<string, unknown>) => doors.atNative(id, input, native);
      const owner = (answered(yield* call('create_block', { tags: ['task'], title: 'Shorten oversized files' })).block as { name: string })
        .name;
      const rule = (answered(yield* call('create_block', { tags: ['rule'], title: 'Small source files' })).block as { name: string }).name;
      expect(
        answered(
          yield* call('enforce_rule', {
            blockId: rule,
            base: null,
            strictness: 'gate',
            inspection: 'size',
            owner,
            on: [{ op: 'submit_work', phase: 'before' }],
          }),
        ),
      ).toMatchObject({ debt: { after: 1 } });
      const writeConfig = (before: string, after: string) =>
        wrote(world, { projectId: project, threadId: thread.id }, root, 'tagma.config.ts', before, after);
      yield* writeConfig(config(5), config(3));
      const preview = answered(yield* call('check_rules', { over: 'change', limit: 10 }));
      expect(preview).toMatchObject({ total: 3, refuses: false, paths: ['tagma.config.ts'] });
      expect(
        (preview.violations as { file: string; owed?: true }[])
          .map(({ file, owed }) => ({ file, owed }))
          .sort((a, b) => a.file.localeCompare(b.file)),
      ).toEqual([
        { file: 'src/debt.ts', owed: true },
        { file: 'src/expenses.ts', owed: undefined },
        { file: 'src/seed.ts', owed: undefined },
      ]);
      const frames = yield* Queue.unbounded<GraphFrame>();
      yield* Effect.acquireRelease(
        Context.get(native.served.context, GraphFeed).subscribe(project, (frame) => {
          Queue.offerUnsafe(frames, frame);
        }),
        (stop) => Effect.sync(stop),
      );
      const landing = answered(yield* call('submit_work', { subject: 'tighten size threshold' })).submitted as {
        status: string;
        commit: string;
        rechecked?: { file: string }[];
      };
      expect(landing).toMatchObject({
        status: 'landed',
        rechecked: [expect.objectContaining({ file: 'src/expenses.ts' }), expect.objectContaining({ file: 'src/seed.ts' })],
      });
      for (;;) {
        const read = answered(yield* call('read_enforcement', { rule, limit: 10 }));
        const escaped = read.escaped as { rows: { path: string; commit: string }[] };
        if (escaped.rows.length === 2) {
          expect(escaped.rows.map(({ path, commit }) => ({ path, commit })).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
            { path: 'src/expenses.ts', commit: landing.commit },
            { path: 'src/seed.ts', commit: landing.commit },
          ]);
          break;
        }
        yield* Queue.take(frames);
      }
      const programmed = `export default ${JSON.stringify({ inspections: { size: { program: 'inspect.js', name: 'repeated', concern: 'size', params: {}, files: ['src/**'] } } })};\n`;
      yield* writeConfig(config(3), programmed);
      const repeated = answered(yield* call('check_rules', { over: 'change', rules: [rule], limit: 10 }));
      const units = repeated.violations as { fingerprint: string }[];
      expect(units).toHaveLength(2);
      expect(new Set(units.map((one) => one.fingerprint)).size).toBe(1);
      const revision = (answered(yield* call('read_enforcement', { rule, limit: 10 })).engine as { revision: string }).revision;
      const accepted = answered(
        yield* call('enforce_rule', { blockId: rule, base: revision, strictness: 'gate', absorb: [units[0]!.fingerprint], owner }),
      );
      expect(accepted.absorbed).toContainEqual(expect.objectContaining({ fingerprint: units[0]!.fingerprint, count: 2 }));
      const covered = answered(yield* call('check_rules', { over: 'change', rules: [rule], limit: 10 }));
      expect((covered.violations as { owed?: true }[]).map((one) => one.owed)).toEqual([true, true]);
      expect(answered(yield* call('submit_work', { subject: 'replace size with a counted inspection' }))).toMatchObject({
        submitted: { status: 'landed' },
      });
    }),
  );

  it.effect('an inspection over the change answers everything it finds in the version the change would land', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('residue'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.makeDirectory(join(root, 'src'));
      for (const path of ['fixed.ts', 'touched.ts', 'standing.ts']) yield* files.writeFileString(join(root, 'src', path), rows(5));
      yield* files.writeFileString(join(root, 'tagma.config.ts'), config(3));
      yield* suiteGit(root, 'add', '-A');
      yield* suiteGit(root, 'commit', '-qm', 'oversized files');
      const added = yield* world.op('add_project', { name: world.uniqueName(), rootPath: root, storage: 'stealth' });
      expect(added.status).toBe(200);
      const project = (added.body as { project: { id: number } }).project.id;
      const born = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${project}`);
      const {
        snapshot: { thread },
      } = yield* Schema.decodeUnknownEffect(threadWireSnapshotPayloadSchema)(born.body);
      const doors = makeThreadDoors(world, project, ['check_rules']);
      const native = yield* doors.doorsFor(thread.id, thread.ownerId);
      const work = { projectId: project, threadId: thread.id };
      yield* wrote(world, work, root, 'src/fixed.ts', rows(5), rows(1));
      yield* wrote(world, work, root, 'src/touched.ts', rows(5), rows(4));
      const residue = answered(
        yield* doors.atNative('check_rules', { over: 'change', inspection: 'size', paths: ['src/fixed.ts', 'src/touched.ts'] }, native),
      );
      expect(residue).toMatchObject({ total: 2, refuses: false, paths: ['src/fixed.ts', 'src/touched.ts'] });
      expect((residue.violations as { file: string }[]).map(({ file }) => file)).toEqual(['src/standing.ts', 'src/touched.ts']);
    }),
  );
});
