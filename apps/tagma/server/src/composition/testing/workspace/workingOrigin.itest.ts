import { retiredAt } from '../../../change-record/testing/holdings.js';
import { fixtureMigrations } from '../migrations.js';
import { sessionIdentityLayer } from '../../../external-harnesses/testing/builtin.js';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { gitMode } from '@runlith/agent-tools/changes/measure';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow } from '../../../projects/store/table.js';
import { projectsLayer } from '../../../projects/registration.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { hostWorkspace } from '../hostWorkspace.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import type { SubmitReceipt } from '../../../landing/contract/wire/receipt.js';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { landingAdmission } from '../../preparedChanges.js';
import { makePreparedChanges } from '../../../change-record/prepared/change.js';
import { UNSHAPED } from '../../../change-record/contract/service/shape.js';
import { quietCommands } from '../../../change-record/testing/doubles.js';
import { claimPreparedInstance, preparedBase } from '../../../change-record/prepared/subject.js';
import { judgingFns } from '../../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { noRuleInPlay } from '../checkoutFixture.js';
import { changeRecordOf, intakeOf, recordOfPath } from '../../../change-record/testing/doubles.js';
import { evidenceInGroups, heldOfThread } from '../../../change-record/record/evidence.js';
import { heldPathsOfProject, pathsOfThread } from '../../../change-record/record/reads.js';
import { checkoutAt, placeIn } from '../../../workspace/roots/proof.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { Coverage, FileRoots } from '../../../workspace/contract/service/roots.js';
import { makeWalks } from '../../../change-record/lines/walks.js';
import { settleIntents } from '../../../change-record/record/intents.js';
import type { WorkingOrigin, WorkingRoot } from '../../../workspace/contract/wire/place.js';
import { landingServices } from '../landingServices.js';
import { submitOver } from '../../../landing/testing/doubles.js';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';

const MINE = 'mirror-git';
const THEIRS = 'amber-fox';
const FILE = ['const one = 1;', 'const two = 2;', 'const three = 3;'];
const machineWorld = makeMachineWorld(() => null);

const makeWorld = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'working-origin-' });
  const context = yield* Layer.build(
    hostWorkspace(machineWorld).pipe(
      Layer.provide(worktreeRecordsLayer),
      Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
      Layer.provideMerge(fixtureGraph({ sourcePath: home }).pipe(Layer.provideMerge(projectsLayer))),
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, {}, yield* sharedPool))),
      Layer.provideMerge(sessionIdentityLayer),
    ),
  );
  const git = Context.get(context, Git);
  const store = Context.get(context, MachineStore);
  const units = Context.get(context, MachineUnits);
  const origins = Context.get(context, WorkingOrigins);
  const coverage = Context.get(context, Coverage);
  const paths = Context.get(context, CheckoutPaths);
  const intake = yield* intakeOf(store, units, git, paths).pipe(Effect.provide(context));
  const record = yield* changeRecordOf(store, units, paths, intake).pipe(Effect.provide(context));
  const services = Context.add(yield* Effect.provide(landingServices, context), ChangeRecord, record);
  const run = (root: string, args: readonly string[]) => runGit(git, 'test', ['-C', root, ...args]);
  const checkout = Effect.fn('workingOrigin.checkout')(function* (name: string) {
    const root = join(home, name);
    yield* files.makeDirectory(join(root, 'src'), { recursive: true });
    yield* run(root, ['init', '-q', '-b', 'main', '.']);
    yield* files.writeFileString(join(root, 'src', 'a.ts'), `${FILE.join('\n')}\n`);
    yield* run(root, ['add', '--', 'src']);
    yield* run(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'as it stood']);
    return root;
  });
  const A = yield* checkout('root-a');
  const B = yield* checkout('root-b');
  const alias = join(home, 'alias-a');
  yield* files.symlink(A, alias);
  const made = yield* store.db
    .insert(projectRow)
    .values({ name: 'w', repoKey: 'w', rootPath: A, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning();
  const projectId = made[0]?.id;
  if (projectId === undefined) return yield* Effect.die('the working-origin fixture inserted no project');
  yield* coverage.cover(projectId);
  yield* coverage.adopt(projectId, B);
  const landing = Effect.fnUntraced(function* (origin: WorkingOrigin) {
    const inst = yield* claimPreparedInstance(preparedBase(store));
    const producer = makePreparedChanges(
      { commands: quietCommands, pathsOfThread, evidenceInGroups },
      landingAdmission(makeLandingHolds()),
      judgingFns(CHECKOUT_DIRECTORY),
      inst.dir,
      UNSHAPED,
    );
    return yield* Effect.ensuring(
      submitOver(
        git,
        origin.root.path,
        store,
        units,
        origin,
        { projectId: origin.work.projectId, tasks: [], taking: [], coAuthored: true },
        noRuleInPlay,
        producer,
      ).pipe(Effect.provideContext(services)),
      inst.release,
    );
  });
  const originOf = (root: string, threadId: string) => origins.of({ projectId, threadId }, root);
  const checkoutOf = Effect.fnUntraced(function* (origin: WorkingRoot | null) {
    if (origin === null) return yield* Effect.die('the origin is unproven');
    return yield* checkoutAt(paths, projectId, origin.root.path);
  });
  const placed = Effect.fnUntraced(function* (origin: WorkingRoot | null, path: string) {
    const place = placeIn(yield* checkoutOf(origin), path);
    if (place === null) return yield* Effect.die(`no registered checkout holds ${path}`);
    return place;
  });
  const wrote = Effect.fn('workingOrigin.wrote')(function* (root: string, threadId: string, path: string, lines: readonly string[]) {
    const origin = yield* originOf(root, threadId);
    const at = join(root, path);
    const before = (yield* files.exists(at)) ? yield* files.readFileString(at) : '';
    const after = `${lines.join('\n')}\n`;
    yield* files.writeFileString(at, after);
    yield* intake.report({ projectId, holder: { kind: 'thread', thread: threadId } }, [
      {
        origin: 'write',
        path: at,
        at: new Date(yield* Clock.currentTimeMillis),
        before: contentDigest(before),
        after: contentDigest(after),
        beforeText: before,
        afterText: after,
        mode: gitMode((yield* files.stat(at)).mode),
        hunk: workspaceChangeHunk(before, after),
      },
    ]);
    return origin;
  });
  return {
    context,
    files,
    home,
    git,
    store,
    units,
    origins,
    coverage,
    intake,
    record,
    landing,
    run,
    checkout,
    A,
    B,
    alias,
    projectId,
    checkoutOf,
    placed,
    originOf,
    wrote,
  };
});
class World extends Context.Service<World, Effect.Success<typeof makeWorld>>()('testing/WorkingOrigins') {}
const fixture = Layer.effectContext(Effect.map(makeWorld, (world) => Context.add(world.context, World, world))).pipe(
  Layer.provideMerge(BunFileSystem.layer),
);
const carried = (receipt: SubmitReceipt): readonly string[] => (receipt.status === 'landed' ? receipt.committed : []);

layer(fixture, { excludeTestServices: true })('working origins', (it) => {
  it.effect('the same relative name in two roots is two files, and each answers its own holder', () =>
    Effect.gen(function* () {
      const w = yield* World;
      yield* w.wrote(w.A, MINE, 'src/a.ts', [...FILE, 'const mine = 1;']);
      yield* w.wrote(w.B, THEIRS, 'src/a.ts', [...FILE, 'const theirs = 2;']);
      const inA = yield* w.originOf(w.A, MINE);
      const inB = yield* w.originOf(w.B, THEIRS);
      expect(inA).not.toBeNull();
      expect(inB).not.toBeNull();
      expect(inA?.witness.token).not.toBe(inB?.witness.token);
      expect((yield* recordOfPath(w.store, yield* w.placed(inA, 'src/a.ts'))).map((row) => row.holder)).toEqual([MINE]);
      expect((yield* recordOfPath(w.store, yield* w.placed(inB, 'src/a.ts'))).map((row) => row.holder)).toEqual([THEIRS]);
    }),
  );

  it.effect('two routes to one root meet the same holder', () =>
    Effect.gen(function* () {
      const w = yield* World;
      yield* w.wrote(w.alias, THEIRS, 'src/aliased.ts', ['const through = 1;']);
      const throughAlias = yield* w.originOf(w.alias, THEIRS);
      const throughRoot = yield* w.originOf(w.A, MINE);
      expect(throughAlias?.witness.token).toBe(throughRoot?.witness.token);
      expect(throughAlias?.root.path).toBe(throughRoot?.root.path);
      expect((yield* recordOfPath(w.store, yield* w.placed(throughRoot, 'src/aliased.ts'))).map((row) => row.holder)).toEqual([THEIRS]);
    }),
  );

  it.effect('a commit aimed at one root carries that root and leaves the other standing', () =>
    Effect.gen(function* () {
      const w = yield* World;
      for (const [root, message] of [
        [w.A, 'base a'],
        [w.B, 'base b'],
      ] as const) {
        yield* w.files.writeFileString(join(root, 'src', 'shared.ts'), `${FILE.join('\n')}\n`);
        yield* w.run(root, ['add', '--', 'src/shared.ts']);
        yield* w.run(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]);
      }
      yield* w.wrote(w.A, MINE, 'src/shared.ts', [...FILE, 'const inA = 1;']);
      const inB = yield* w.wrote(w.B, MINE, 'src/shared.ts', [...FILE, 'const inB = 2;']);
      expect(inB).not.toBeNull();
      if (inB === null) return;
      const receipt = yield* w.landing({ ...inB, work: { projectId: w.projectId, threadId: MINE } });
      expect(receipt.status).toBe('landed');
      expect(carried(receipt)).toContain('src/shared.ts');
      const landedInB = yield* w.run(w.B, ['show', 'HEAD:src/shared.ts']);
      expect(landedInB).toContain('const inB = 2;');
      expect(landedInB).not.toContain('const inA = 1;');
      expect(yield* w.files.readFileString(join(w.A, 'src', 'shared.ts'))).toContain('const inA = 1;');
      expect(yield* w.run(w.A, ['show', 'HEAD:src/shared.ts'])).not.toContain('const inA = 1;');
      expect((yield* heldOfThread(w.units, w.store, w.projectId, MINE)).some((row) => row.path === 'src/shared.ts')).toBe(true);
    }),
  );

  it.effect('a commit reached through an alias carries what was written through the root', () =>
    Effect.gen(function* () {
      const w = yield* World;
      yield* w.wrote(w.A, MINE, 'src/aliased-carry.ts', ['const written = 1;']);
      const throughAlias = yield* w.originOf(w.alias, MINE);
      expect(throughAlias).not.toBeNull();
      if (throughAlias === null) return;
      const receipt = yield* w.landing({ ...throughAlias, work: { projectId: w.projectId, threadId: MINE } });
      expect(carried(receipt)).toContain('src/aliased-carry.ts');
      expect(yield* w.run(w.A, ['show', 'HEAD:src/aliased-carry.ts'])).toContain('const written = 1;');
    }),
  );

  it.effect('a watcher over one checkout settles nothing another checkout is holding', () =>
    Effect.gen(function* () {
      const w = yield* World;
      for (const root of [w.A, w.B]) {
        yield* w.files.writeFileString(join(root, 'src', 'watched.ts'), `${FILE.join('\n')}\n`);
        yield* w.run(root, ['add', '--', 'src/watched.ts']);
        yield* w.run(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base watched']);
      }
      yield* w.wrote(w.A, THEIRS, 'src/watched.ts', [...FILE, 'const inA = 1;']);
      const inB = yield* w.originOf(w.B, MINE);
      expect(inB).not.toBeNull();
      if (inB === null) return;
      expect(yield* heldPathsOfProject(w.units, w.store, yield* w.checkoutOf(inB))).not.toContain('src/watched.ts');
      expect((yield* retiredAt(w.store, w.units, w.git, w.B, yield* w.checkoutOf(inB))).committed).toEqual([]);
      expect((yield* heldOfThread(w.units, w.store, w.projectId, THEIRS)).find((row) => row.path === 'src/watched.ts')?.newText).toContain(
        'const inA = 1;',
      );
    }),
  );

  it.effect('a root that was renamed still answers for the work recorded in it', () =>
    Effect.gen(function* () {
      const w = yield* World;
      const moving = yield* w.checkout('root-moving');
      yield* w.coverage.adopt(w.projectId, moving);
      const before = yield* w.wrote(moving, MINE, 'src/a.ts', [...FILE, 'const moved = 1;']);
      expect(before).not.toBeNull();
      if (before === null) return;
      const checkoutBefore = yield* w.checkoutOf(before);
      const moved = join(w.home, 'root-moved');
      yield* w.files.rename(moving, moved);
      const after = yield* w.originOf(moved, MINE);
      expect(after).not.toBeNull();
      if (after === null) return;
      expect(after.witness.token).toBe(before.witness.token);
      expect(after.root.path).not.toBe(before.root.path);
      expect(yield* w.checkoutOf(after)).toBe(checkoutBefore);
      expect((yield* recordOfPath(w.store, yield* w.placed(after, 'src/a.ts'))).map((row) => row.holder)).toEqual([MINE]);
      expect(carried(yield* w.landing({ ...after, work: { projectId: w.projectId, threadId: MINE } }))).toContain('src/a.ts');
      expect(yield* w.run(moved, ['show', 'HEAD:src/a.ts'])).toContain('const moved = 1;');
    }),
  );

  it.effect('a thread standing in one checkout writes a file of another, and the row stands in the checkout holding the file', () =>
    Effect.gen(function* () {
      const w = yield* World;
      const standing = yield* w.originOf(w.B, THEIRS);
      expect(yield* w.checkoutOf(standing)).not.toBeNull();
      const at = join(w.A, 'src', 'crossed.ts');
      yield* w.files.writeFileString(at, 'const crossed = 1;\n');
      const places = yield* w.intake.report({ projectId: w.projectId, holder: { kind: 'thread', thread: THEIRS } }, [
        {
          origin: 'write',
          path: at,
          at: new Date(yield* Clock.currentTimeMillis),
          before: contentDigest(''),
          after: contentDigest('const crossed = 1;\n'),
        },
      ]);
      const inA = yield* w.originOf(w.A, MINE);
      expect(places).toEqual([yield* w.placed(inA, 'src/crossed.ts')]);
      expect((yield* recordOfPath(w.store, yield* w.placed(inA, 'src/crossed.ts'))).map((row) => row.holder)).toEqual([THEIRS]);
      expect(yield* pathsOfThread(w.units, w.store, w.projectId, THEIRS, yield* w.checkoutOf(standing))).not.toContainEqual(
        expect.objectContaining({ path: 'src/crossed.ts' }),
      );
    }),
  );

  it.effect('a file outside every checkout of the project records no row', () =>
    Effect.gen(function* () {
      const w = yield* World;
      const outside = join(w.home, 'outside.ts');
      yield* w.files.writeFileString(outside, 'const out = 1;\n');
      expect(
        yield* w.intake.report({ projectId: w.projectId, holder: { kind: 'thread', thread: MINE } }, [
          {
            origin: 'write',
            path: outside,
            at: new Date(yield* Clock.currentTimeMillis),
            before: contentDigest(''),
            after: contentDigest('const out = 1;\n'),
          },
        ]),
      ).toEqual([]);
    }),
  );

  it.effect('a write the server died after, before its row was confirmed, is confirmed at the next start when the disk holds it', () =>
    Effect.gen(function* () {
      const w = yield* World;
      const path = join(w.A, 'src', 'intent.ts');
      const after = 'const written = 1;\n';
      const died = yield* Effect.exit(
        w.intake.land(
          { projectId: w.projectId, holder: { kind: 'thread', thread: MINE } },
          [
            {
              origin: 'write',
              path,
              at: new Date(yield* Clock.currentTimeMillis),
              before: contentDigest(''),
              after: contentDigest(after),
              beforeText: '',
              afterText: after,
            },
          ],
          Effect.andThen(w.files.writeFileString(path, after), Effect.die('the server died here')),
        ),
      );
      expect(died._tag).toBe('Failure');
      const walks = yield* Effect.acquireRelease(
        Effect.sync(() => makeWalks({ size: 1 })),
        (opened) => opened.close,
      );
      expect((yield* settleIntents(w.units, w.store, Context.get(w.context, FileRoots), walks)).confirmed).toBe(1);
      expect(
        (yield* recordOfPath(w.store, yield* w.placed(yield* w.originOf(w.A, MINE), 'src/intent.ts'))).map((row) => row.holder),
      ).toEqual([MINE]);
    }),
  );

  it.effect('a write stopped while it lands still confirms the row of the bytes it wrote', () =>
    Effect.gen(function* () {
      const w = yield* World;
      const path = join(w.A, 'src', 'stopped.ts');
      const after = 'const stopped = 1;\n';
      const started = yield* Deferred.make<void>();
      const proceed = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkScoped(
        w.intake.land(
          { projectId: w.projectId, holder: { kind: 'thread', thread: MINE } },
          [
            {
              origin: 'write',
              path,
              at: new Date(yield* Clock.currentTimeMillis),
              before: contentDigest(''),
              after: contentDigest(after),
              beforeText: '',
              afterText: after,
            },
          ],
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(proceed);
            yield* w.files.writeFileString(path, after);
            return true;
          }),
        ),
      );
      yield* Deferred.await(started);
      yield* Effect.sync(() => fiber.interruptUnsafe());
      yield* Deferred.succeed(proceed, undefined);
      yield* Fiber.await(fiber);
      expect(yield* w.files.readFileString(path)).toBe(after);
      expect(
        (yield* recordOfPath(w.store, yield* w.placed(yield* w.originOf(w.A, MINE), 'src/stopped.ts'))).map((row) => row.holder),
      ).toEqual([MINE]);
    }),
  );
});
