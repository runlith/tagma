import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Git } from '@runlith/git/Git';
import { gitMode } from '@runlith/agent-tools/changes/measure';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { fixtureMigrations } from '../migrations.js';
import { testSessionIdentityLayer } from '../../../platform/testing/identity.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { workspaceChange, workspaceChangeText } from '../../../change-record/store/tables.js';
import { project as projectRow } from '../../../projects/store/table.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { projectsLayer } from '../../../projects/registration.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { liveGitLayer } from '../liveGit.js';
import { changeRecordOf, intakeOf } from '../../../change-record/testing/doubles.js';
import { fixedCheckoutPaths, hostRootProver } from '../../../workspace/testing/doubles.js';
import { EnvironmentBinding } from '../../../workspace/contract/wire/environments.js';
import { Environments } from '../../../workspace/contract/service/environments.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { stripComments } from '../../../change-record/sweep/stripComments.js';
import { namesOfHolders } from '../../../change-record/record/sessions.js';
import { sweepProse } from '@runlith/agent-tools/sweepProse';
import { toolOptions } from '@runlith/agent-tools/testing/options';

const MINE = 'mirror-git';
const THEIRS = 'amber-fox';
const MIXED = [
  '// what this module is for, at length',
  'export const kept = 1;',
  '//! why the next line cannot be code',
  '// @ts-expect-error the call below is wrong on purpose',
  'export const also = 2;',
  '/**',
  ' * Adds two numbers together.',
  ' * @param left the first',
  ' */',
  'export const add = (left: number) => left;',
  '/**',
  ' * A description of what this does, with no tag at all.',
  ' */',
  'export const described = 3;',
  '',
].join('\n');
const PLAIN = ['// one', 'export const plain = 1;', '// two', 'export const second = 2;', ''].join('\n');
const EXEMPT = ['//! comments', '// this file stands whole', 'export const exempt = 1;', ''].join('\n');
const BROKEN = ['// prose above a token nothing can close', 'export const broken = `unterminated', ''].join('\n');
const DOCUMENT = ['# a title', '', '<!-- a markdown comment -->', ''].join('\n');
const SWEPT = 'sweep-root';
const makeSweepFixture = Effect.gen(function* () {
  const context = yield* Layer.build(Layer.merge(BunFileSystem.layer, liveGitLayer));
  const files = Context.get(context, FileSystem.FileSystem);
  const git = Context.get(context, Git);
  const template = yield* files.makeTempDirectoryScoped({ prefix: 'sweep-template-' });
  for (const [path, text] of [
    ['.gitignore', 'ignored/\n'],
    ['src/mixed.ts', MIXED],
    ['src/plain.ts', PLAIN],
    ['src/exempt.ts', EXEMPT],
    ['src/broken.ts', BROKEN],
    ['README.md', DOCUMENT],
    ['ignored/skipped.ts', PLAIN],
    [`${CHECKOUT_DIRECTORY}/blocks/kept.ts`, PLAIN],
  ]) {
    const at = join(template, path!);
    yield* files.makeDirectory(dirname(at), { recursive: true });
    yield* files.writeFileString(at, text!);
  }
  const run = (args: readonly string[]) => runGit(git, 'test', ['-C', template, ...args]);
  yield* run(['init', '-q', '-b', 'main', '.']);
  yield* run(['add', '--', '.']);
  yield* run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'the tree as it stood']);
  const binding = yield* Schema.decodeUnknownEffect(EnvironmentBinding)({
    environmentId: 'env-sweep',
    kind: 'host',
    namespaceId: 'ns-sweep',
    identityWitness: { provider: 'sweep', format: 'sweep', token: 'sweep' },
  });
  return { context, template, binding };
});
class SweepFixture extends Context.Service<SweepFixture, Effect.Success<typeof makeSweepFixture>>()('testing/SweepFixture') {}
const checkout = Effect.gen(function* () {
  const fixture = yield* SweepFixture;
  const files = Context.get(fixture.context, FileSystem.FileSystem);
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'sweep-' });
  const root = join(home, 'checkout');
  yield* files.copy(fixture.template, root);
  const graph = yield* Layer.build(
    Layer.mergeAll(fixtureGraph({ sourcePath: root }).pipe(Layer.provideMerge(projectsLayer)), unitsLayer(MachineUnits, MachineStore)).pipe(
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, {}, sharedPool))),
      Layer.provideMerge(testSessionIdentityLayer),
    ),
  );
  const context = Context.merge(fixture.context, graph);
  const git = Context.get(context, Git);
  const store = Context.get(context, MachineStore);
  const units = Context.get(context, MachineUnits);
  const rows = yield* store.db
    .insert(projectRow)
    .values({ name: 'w', repoKey: 'w', rootPath: root, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning();
  const row = rows[0];
  if (row === undefined) return yield* Effect.die('the sweep fixture project was not inserted');
  const projectId = row.id;
  const named = (threadId: string, name: string, home = projectId) =>
    bornThread(
      store.db,
      {
        id: threadId,
        spawnRootId: threadId,
        cacheGroup: threadId,
        name,
        ownerId: 'owner',
        agentId: 'tagma',
        provider: 'openai-oauth',
        model: 'gpt-test',
        reasoning: 'high',
        authority: { mode: 'trust', bypassFrom: null },
        status: 'idle',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      { projectId: home, title: name, readerOrderAt: new Date(0) },
    );
  const unused = () => Effect.die('the sweep fixture only inspects its host binding');
  const origins = yield* hostRootProver(
    Environments.of({
      inspect: () =>
        Effect.succeed({
          identity: fixture.binding,
          binding: fixture.binding,
          availability: 'available',
          capabilities: { files: true, exec: false, heldExecution: false, egress: false },
          reason: null,
        }),
      acquireActive: unused,
      activate: unused,
      release: unused,
      releaseUse: unused,
      heldUses: unused,
    }),
  ).pipe(Effect.provide(context));
  const paths = yield* fixedCheckoutPaths(projectId, [{ checkout: SWEPT, root }]).pipe(Effect.provide(context));
  const record = yield* changeRecordOf(store, units, paths, yield* intakeOf(store, units, git, paths).pipe(Effect.provide(context))).pipe(
    Effect.provide(context),
  );
  const holds = Effect.fnUntraced(function* (threadId: string, path: string, after: string, home = projectId) {
    const at = join(root, path);
    const before = yield* files.readFileString(at);
    yield* files.writeFileString(at, after);
    return yield* record.report({ work: { projectId: home, threadId } }, [
      {
        origin: 'edit',
        path: at,
        at: new Date(1_000),
        hunk: workspaceChangeHunk(before, after),
        before: contentDigest(before),
        after: contentDigest(after),
        mode: gitMode((yield* files.stat(at)).mode),
      },
    ]);
  });
  const holdsElsewhere = (threadId: string, path: string) =>
    store.db
      .insert(workspaceChange)
      .values({
        projectId,
        holderProjectId: projectId,
        holder: threadId,
        runId: null,
        checkout: 'elsewhere-checkout',
        path,
        state: 'held',
        origin: 'edit',
        firstLine: 1,
        lines: 1,
        beforeHash: contentDigest('before'),
        afterHash: contentDigest('after'),
        at: new Date(1_000),
      })
      .returning({ id: workspaceChange.id })
      .pipe(
        Effect.flatMap((rows) =>
          store.db.insert(workspaceChangeText).values(rows.map(({ id }) => ({ row: id, oldText: 'before\n', newText: 'after\n' }))),
        ),
      );
  const sweep = Effect.fnUntraced(
    function* (path: string) {
      const origin = yield* origins.of({ projectId, threadId: MINE }, root);
      return yield* stripComments(
        {
          git,
          machine: store,
          sessionNames: (threadIds) => namesOfHolders(store, threadIds),
          threadId: MINE,
          root,
          graphDirectory: CHECKOUT_DIRECTORY,
          checkout: origin === null ? null : SWEPT,
          sweepProse: (paths) =>
            sweepProse(
              toolOptions({ cwd: root, changes: record.changes({ work: { projectId, threadId: MINE } }), unowned: [CHECKOUT_DIRECTORY] }),
              paths,
            ),
        },
        path,
      );
    },
    (effect, _path: string) => Effect.provide(effect, context),
  );
  const foreignHome = Effect.fnUntraced(function* () {
    const rows = yield* store.db
      .insert(projectRow)
      .values({ name: 'foreign', repoKey: 'foreign', rootPath: join(home, 'foreign'), createdAt: new Date(yield* Clock.currentTimeMillis) })
      .returning();
    const row = rows[0];
    if (row === undefined) return yield* Effect.die('the foreign sweep project was not inserted');
    return row.id;
  });
  return {
    root,
    projectId,
    named,
    foreignHome,
    holds,
    holdsElsewhere,
    sweep,
    text: (path: string) => files.readFileString(join(root, path)),
    rows: () => store.db.select().from(workspaceChange),
  };
});

layer(Layer.effect(SweepFixture, makeSweepFixture), { excludeTestServices: true })('comment sweeps', (it) => {
  it.effect('a sweep removes standing prose from lexable files and records its own writes', () =>
    Effect.gen(function* () {
      const world = yield* checkout;
      const swept = yield* world.sweep('.');
      const mixed = yield* world.text('src/mixed.ts');
      expect(mixed).toContain('//! why the next line cannot be code');
      expect(mixed).toContain('// @ts-expect-error the call below is wrong on purpose');
      expect(mixed).toContain(' * @param left the first');
      expect(mixed).not.toContain('// what this module is for, at length');
      expect(mixed).not.toContain('A description of what this does');
      expect(mixed).toContain('export const described = 3;');
      expect(yield* world.text('src/plain.ts')).toBe('export const plain = 1;\nexport const second = 2;\n');
      expect(yield* world.text('src/exempt.ts')).toBe(EXEMPT);
      expect(yield* world.text('src/broken.ts')).toBe(BROKEN);
      expect(yield* world.text('README.md')).toBe(DOCUMENT);
      expect(yield* world.text('ignored/skipped.ts')).toBe(PLAIN);
      expect(yield* world.text(`${CHECKOUT_DIRECTORY}/blocks/kept.ts`)).toBe(PLAIN);
      expect(swept.stripped).toEqual([
        { path: 'src/mixed.ts', dropped: 2 },
        { path: 'src/plain.ts', dropped: 2 },
      ]);
      expect(swept.exempt).toEqual(['src/exempt.ts']);
      expect(swept.unlexable.map((file) => file.path)).toEqual(['src/broken.ts']);
      expect(swept.dropped).toBe(4);
      expect(swept.read).toBe(4);
      expect(swept.linesHeld).toEqual([]);
      expect(swept.unrecorded).toEqual([]);
      expect((yield* world.rows()).map((row) => ({ path: row.path, origin: row.origin, threadId: row.holder }))).toEqual([
        { path: 'src/mixed.ts', origin: 'write', threadId: MINE },
        { path: 'src/plain.ts', origin: 'write', threadId: MINE },
      ]);
    }),
  );
  it.effect('a foreign-home holder keeps its path unchanged while the remaining files land', () =>
    Effect.gen(function* () {
      const world = yield* checkout;
      const home = yield* world.foreignHome();
      yield* world.named(THEIRS, 'amber-fox', home);
      const theirs = `${PLAIN}// a line of theirs, half written\n`;
      yield* world.holds(THEIRS, 'src/plain.ts', theirs, home);
      const swept = yield* world.sweep('src');
      expect(yield* world.text('src/plain.ts')).toBe(theirs);
      expect(swept.linesHeld).toEqual([{ path: 'src/plain.ts', holders: ['amber-fox'] }]);
      expect(swept.stripped).toEqual([{ path: 'src/mixed.ts', dropped: 2 }]);
      expect(yield* world.text('src/mixed.ts')).not.toContain('// what this module is for, at length');
      expect((yield* world.rows()).filter((row) => row.holder === MINE).map((row) => row.path)).toEqual(['src/mixed.ts']);
    }),
  );
  it.effect('the same spelling held in another checkout does not prevent a local sweep', () =>
    Effect.gen(function* () {
      const world = yield* checkout;
      yield* world.named(THEIRS, 'amber-fox');
      yield* world.holdsElsewhere(THEIRS, 'src/plain.ts');
      const swept = yield* world.sweep('src');
      expect(swept.linesHeld).toEqual([]);
      expect(yield* world.text('src/plain.ts')).toBe('export const plain = 1;\nexport const second = 2;\n');
      expect(swept.stripped).toEqual([
        { path: 'src/mixed.ts', dropped: 2 },
        { path: 'src/plain.ts', dropped: 2 },
      ]);
    }),
  );
});
