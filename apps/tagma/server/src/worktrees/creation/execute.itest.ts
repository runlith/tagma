import { makeCoverageStore } from '../../workspace/store/coverage.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { OPERATION_ID } from '../contract/wire/creation.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Option, Path, Result, Schema } from 'effect';
import { Git, GitUnavailable, gitLayer } from '@runlith/git/Git';
import { worktreesOf } from '@runlith/git/worktree';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { NamespaceId } from '@runlith/files/namespace';
import { witnessOf } from '@runlith/files/witness';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { fixtureHome } from '../../platform/testing/roots.js';
import { repository } from '../../workspace/store/tables.js';
import { project } from '../../projects/store/table.js';
import type { AcquiredEnvironment } from '../../workspace/contract/service/environments.js';
import { environmentLedger, fileRootStore, repositoryRegistry, repositoryStore, rootRegistry } from '../../workspace/testing/doubles.js';
import { makeBackendRegistry } from '../../workspace/environments/backends.js';
import { makeEnvironmentStore } from '../../workspace/store/environments.js';
import { makeEnvironmentUseStore } from '../../workspace/store/environmentUses.js';
import { makeEnvironmentUses } from '../../workspace/environments/uses.js';
import { makeHostEnvironment } from '../../executions/host/environmentBackend.js';
import { makeMachineWorld } from '../../executions/worlds/machine.js';
import { WorktreeRevision, type WorktreeRequest } from '../contract/wire/creation.js';
import { worktreeCreator, worktreeStore } from '../testing/doubles.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machineWorld = makeMachineWorld(() => null);
const storage = Layer.unwrap(
  Effect.map(sharedPool, (pool) =>
    unitsLayer(MachineUnits, MachineStore).pipe(
      Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool)),
    ),
  ),
);
const layers = Layer.mergeAll(BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)));

const run = (git: Git['Service'], cwd: string, args: readonly string[]): Effect.Effect<string> =>
  Effect.orDie(
    Effect.flatMap(git.run(args, { cwd }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(`git ${args.join(' ')} in ${cwd}: ${answer.stderr}`),
    ),
  );

class RepoSeeds extends Context.Service<
  RepoSeeds,
  {
    readonly empty: string;
    readonly committed: string;
    readonly head: string;
  }
>()('testing/RepoSeeds') {}

const seeded = Layer.effect(
  RepoSeeds,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const git = yield* Git;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'creation-seeds-' });
    const empty = paths.join(home, 'empty');
    const committed = paths.join(home, 'committed');
    yield* files.makeDirectory(empty);
    yield* run(git, empty, ['init', '-q', '-b', 'main']);
    yield* run(git, empty, ['config', 'user.email', 'git@test']);
    yield* run(git, empty, ['config', 'user.name', 'git']);
    yield* files.copy(empty, committed, { overwrite: true });
    yield* run(git, committed, ['commit', '-q', '--allow-empty', '-m', 'born']);
    return RepoSeeds.of({ empty, committed, head: yield* run(git, committed, ['rev-parse', 'HEAD']) });
  }),
).pipe(Layer.provideMerge(layers));

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const git = yield* Git;
  const seeds = yield* RepoSeeds;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: 'worktrees-' }));
  const anchor = yield* files.makeTempDirectoryScoped({ prefix: 'worktrees-anchor-' });
  const access = yield* environmentLedger(
    makeBackendRegistry({ backends: [yield* makeHostEnvironment({ records: makeEnvironmentStore({ db }), anchor, world: machineWorld })] }),
    makeEnvironmentUses({ uses: makeEnvironmentUseStore({ db }) }),
    units,
  );
  const looked = yield* access.inspect('host');
  if (looked.binding === null) return yield* Effect.die(`the host environment did not answer: ${looked.reason}`);
  const acquired = yield* access.acquireActive({
    binding: looked.binding,
    consumer: { kind: 'test', id: 'worktrees' },
    requires: ['files', 'exec'],
  });
  const namespaceId = acquired.binding.namespaceId;
  const records = yield* fileRootStore(db, units);
  const operations = yield* worktreeStore(makeCoverageStore({ db }));
  const roots = yield* rootRegistry(records, files, paths, namespaceId, operations);
  const repositories = yield* repositoryRegistry(yield* repositoryStore(db, units), git, files, paths, namespaceId);
  const born = Effect.fn(function* (name: string) {
    const root = paths.join(home, name);
    yield* files.copy(seeds.empty, root, { overwrite: true });
    return root;
  });
  const grown = Effect.fn(function* (name: string) {
    const root = paths.join(home, name);
    yield* files.copy(seeds.committed, root, { overwrite: true });
    return { root, head: seeds.head };
  });
  const seen = Effect.fn(function* (path: string, gitDirectory: string) {
    const info = yield* files.stat(path);
    const minted = witnessOf({
      type: info.type,
      inode: Option.getOrNull(info.ino),
      birthtime: Option.isNone(info.birthtime) ? null : info.birthtime.value.getTime(),
    });
    if (Result.isFailure(minted)) return yield* Effect.die(`no witness for ${path}: ${minted.failure}`);
    return { path, witness: minted.success, gitDirectory };
  });
  const registrar = Effect.fn(function* (name: string) {
    const row = yield* db
      .insert(project)
      .values({
        name,
        repoKey: paths.join(home, name),
        rootPath: home,
        createdAt: new Date(yield* Clock.currentTimeMillis),
      })
      .returning()
      .get();
    return row?.id ?? 0;
  });
  return {
    files,
    paths,
    git,
    db,
    units,
    records,
    home,
    acquired,
    namespaceId,
    roots,
    repositories,
    born,
    grown,
    operations,
    seen,
    projectId: yield* registrar('registrar'),
    worktrees: yield* worktreeCreator({ intents: operations, records: operations, repositories, roots, git, files, paths, units }),
  };
});

const creating = (args: readonly string[]): boolean => args.some((word, at) => word === 'worktree' && args[at + 1] === 'add');

layer(seeded, { excludeTestServices: true })('creation', (it) => {
  it.effect('an operation id is refused unless every surface can address it', () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(OPERATION_ID);
      const taken = (id: string) => Effect.map(Effect.result(decode(id)), (one) => one._tag);

      for (const id of ['made-once', 'wt.42', '01a08171-b808-7436-b4e0-5e005fc734d2', 'A_b-1.2']) {
        expect(yield* taken(id)).toBe('Success');
      }
      for (const id of ['', 'feature/one', '.', '..', 'a b', 'has#hash', 'x'.repeat(201)]) {
        expect(yield* taken(id)).toBe('Failure');
      }
    }),
  );

  it.effect('one approved creation makes one checkout, and repeating it makes none', () =>
    Effect.gen(function* () {
      const { paths, git, home, acquired, namespaceId, roots, repositories, grown, projectId, worktrees } = yield* fixture;
      const { root: main, head } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const operationId = RequestKey.make('made-once');
      const destination = paths.join(home, 'side');
      const intent: WorktreeRequest = {
        operationId,
        projectId,
        repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
        destination,
        mode: { kind: 'new-branch', branch: 'side', start: 'main' },
      };

      const prepared = yield* worktrees.prepare({ intent, acquired });

      expect(prepared.subjects).toEqual({
        namespaceId,
        repository: intent.repository,
        destination: { namespaceId, path: destination },
        ref: 'refs/heads/side',
      });
      expect(prepared.operation.status).toBe('pending');
      expect(prepared.operation.reserved).toBe(false);
      expect(prepared.operation.base).toBe(head);
      expect(yield* Effect.map(worktreesOf(git, main), (list) => list.length)).toBe(1);

      const made = yield* worktrees.execute({ operationId, projectId, acquired });

      expect(made.status).toBe('ready');
      expect(made.reserved).toBe(true);
      expect(made.evidence?.status).toBe(0);
      if (made.rootId === null) return yield* Effect.die('a ready creation names no root');
      const root = yield* roots.read(made.rootId);
      expect(root.path).toBe(destination);
      expect(root.provenance).toEqual({ kind: 'worktree', id: operationId });
      expect(root.git?.repositoryId).toBe(store.repositoryId);
      expect(root.git?.gitDirectory).toEqual({ namespaceId, path: paths.join(main, '.git', 'worktrees', 'side') });

      expect(yield* worktrees.execute({ operationId, projectId, acquired })).toEqual(made);
      expect(yield* worktrees.read(operationId, projectId)).toEqual(made);
      expect(yield* worktrees.prepare({ intent, acquired })).toEqual({ subjects: prepared.subjects, operation: made });
      expect(yield* Effect.map(worktreesOf(git, main), (list) => list.map((one) => one.path))).toEqual([main, destination]);

      const changed = yield* Effect.flip(
        worktrees.prepare({
          intent: { ...intent, mode: { kind: 'new-branch', branch: 'other', start: 'main' } },
          acquired,
        }),
      );
      expect(changed._tag).toBe('WorktreeRefused');
      if (changed._tag === 'WorktreeRefused') expect(changed.reason).toBe('changed-payload');
    }).pipe(Effect.provide(storage)),
  );

  it.effect('two deliveries of one approval racing each other reach git once', () =>
    Effect.gen(function* () {
      const { files, paths, git, db, units, home, acquired, roots, grown, projectId, repositories } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const asked: (readonly string[])[] = [];
      const watched: Git['Service'] = {
        run: (args, options) =>
          Effect.flatMap(
            Effect.sync(() => {
              asked.push(args);
            }),
            () => git.run(args, options),
          ),
      };
      const worktrees = yield* worktreeCreator({
        intents: yield* worktreeStore(makeCoverageStore({ db })),
        records: yield* worktreeStore(makeCoverageStore({ db })),
        repositories,
        roots,
        git: watched,
        files,
        paths,
        units,
      });
      const operationId = RequestKey.make('raced');
      const destination = paths.join(home, 'side');
      yield* worktrees.prepare({
        intent: {
          operationId,
          projectId,
          repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
          destination,
          mode: { kind: 'new-branch', branch: 'side', start: 'main' },
        },
        acquired,
      });

      const raced = yield* Effect.all(
        [
          Effect.result(worktrees.execute({ operationId, projectId, acquired })),
          Effect.result(worktrees.execute({ operationId, projectId, acquired })),
        ],
        { concurrency: 2 },
      );

      expect(raced.map((one) => one._tag)).toEqual(['Success', 'Success']);
      const created = asked.filter((args) => args.some((word, at) => word === 'worktree' && args[at + 1] === 'add'));
      expect(created).toHaveLength(1);
      expect((yield* worktrees.read(operationId, projectId)).status).toBe('ready');
      expect(yield* Effect.map(worktreesOf(git, main), (list) => list.map((one) => one.path))).toEqual([main, destination]);
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a preparation resolves an absent destination, a local base and an explicit mode, or refuses', () =>
    Effect.gen(function* () {
      const { files, paths, db, units, home, acquired, records, git, roots, repositories, born, grown, projectId, worktrees } =
        yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const empty = yield* born('empty');
      const hollow = yield* repositories.register({ path: empty, projectId });
      const standing = yield* files.makeDirectory(paths.join(home, 'standing')).pipe(Effect.as(paths.join(home, 'standing')));
      const asked = (name: string, intent: Partial<WorktreeRequest>): WorktreeRequest => ({
        operationId: RequestKey.make(name),
        projectId,
        repository,
        destination: paths.join(home, name),
        mode: { kind: 'new-branch', branch: name, start: 'main' },
        ...intent,
      });
      const refusedBy = Effect.fn(function* (intent: WorktreeRequest) {
        const refusal = yield* Effect.flip(worktrees.prepare({ intent, acquired }));
        return refusal._tag === 'WorktreeRefused' ? refusal.reason : refusal._tag;
      });

      expect(
        yield* refusedBy(
          asked('unborn', {
            repository: { repositoryId: hollow.repositoryId, locationRevision: hollow.locationRevision },
            mode: { kind: 'detached', start: 'HEAD' },
          }),
        ),
      ).toBe('base-absent');
      expect(yield* refusedBy(asked('gone', { mode: { kind: 'detached', start: 'refs/heads/never' } }))).toBe('base-absent');
      expect(yield* refusedBy(asked('occupied', { destination: standing }))).toBe('destination-occupied');
      expect(yield* refusedBy(asked('nowhere', { destination: paths.join(home, 'absent', 'deep') }))).toBe('parent-missing');
      expect(yield* refusedBy(asked('relative', { destination: 'relative/side' }))).toBe('relative-path');
      expect(yield* refusedBy(asked('taken', { mode: { kind: 'new-branch', branch: 'main', start: 'main' } }))).toBe('ref-occupied');
      expect(yield* refusedBy(asked('missing', { mode: { kind: 'existing-branch', branch: 'never' } }))).toBe('ref-missing');

      const other = NamespaceId.make('other-worktrees');
      const elsewhere = yield* worktreeCreator({
        intents: yield* worktreeStore(makeCoverageStore({ db })),
        records: yield* worktreeStore(makeCoverageStore({ db })),
        repositories: yield* repositoryRegistry(yield* repositoryStore(db, units), git, files, paths, other),
        roots: yield* rootRegistry(records, files, paths, other, yield* worktreeStore(makeCoverageStore({ db }))),
        git,
        files,
        paths,
        units,
      });
      const foreign = yield* Effect.flip(elsewhere.prepare({ intent: asked('foreign', {}), acquired }));
      expect(foreign._tag).toBe('WorktreeRefused');
      if (foreign._tag === 'WorktreeRefused') expect(foreign.reason).toBe('foreign-namespace');
      expect((yield* roots.resolveFootprint(main)).roots).toEqual([]);
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a branch checked out elsewhere fails before any effect, and releases what it held', () =>
    Effect.gen(function* () {
      const { files, paths, git, home, acquired, seen, grown, projectId, repositories, worktrees } = yield* fixture;
      const { root: main } = yield* grown('main');
      const held = paths.join(home, 'held');
      yield* run(git, main, ['worktree', 'add', '-q', '-b', 'side', held]);
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const destination = paths.join(home, 'wanted');
      const blocked = RequestKey.make('blocked');
      yield* worktrees.prepare({
        intent: {
          operationId: blocked,
          projectId,
          repository,
          destination,
          mode: { kind: 'existing-branch', branch: 'side' },
        },
        acquired,
      });

      const failed = yield* worktrees.execute({ operationId: blocked, projectId, acquired });

      expect(failed.status).toBe('failed');
      expect(failed.rootId).toBe(null);
      expect(failed.reserved).toBe(true);
      expect(failed.evidence?.status).not.toBe(0);
      expect(failed.evidence?.destination).toBe('absent');
      expect(failed.evidence?.message).not.toBe('');
      expect(failed.evidence?.command).toContain(destination);
      expect(failed.evidence?.retained).toEqual([]);
      expect(yield* files.exists(destination)).toBe(false);
      expect(yield* Effect.map(worktreesOf(git, main), (list) => list.length)).toBe(2);
      expect(yield* worktrees.execute({ operationId: blocked, projectId, acquired })).toEqual(failed);
      const nothing = yield* Effect.flip(
        worktrees.adopt({
          recovery: {
            projectId,
            operationId: blocked,
            revision: failed.revision,
            observed: yield* seen(held, paths.join(main, '.git', 'worktrees', 'held')),
          },
          acquired,
        }),
      );
      expect(nothing._tag).toBe('WorktreeRefused');
      if (nothing._tag === 'WorktreeRefused') expect(nothing.reason).toBe('settled');
      const unresolvable = yield* Effect.flip(
        worktrees.prepareRecovery({
          operationId: blocked,
          projectId,
          observed: held,
          acquired,
        }),
      );
      expect(unresolvable._tag).toBe('WorktreeRefused');
      if (unresolvable._tag === 'WorktreeRefused') expect(unresolvable.reason).toBe('settled');

      const after = RequestKey.make('after');
      yield* worktrees.prepare({
        intent: { operationId: after, projectId, repository, destination, mode: { kind: 'detached', start: 'main' } },
        acquired,
      });
      expect((yield* worktrees.execute({ operationId: after, projectId, acquired })).status).toBe('ready');
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a hook failing over written files is uncertain, and recovery adopts exactly what stands', () =>
    Effect.gen(function* () {
      const { files, paths, git, home, acquired, namespaceId, roots, seen, grown, projectId, repositories, worktrees } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const destination = paths.join(home, 'side');
      const made = RequestKey.make('hooked');
      const samePlace = RequestKey.make('same-place');
      const sameRef = RequestKey.make('same-ref');
      const mode = { kind: 'new-branch', branch: 'side', start: 'main' } as const;
      yield* worktrees.prepare({ intent: { operationId: made, projectId, repository, destination, mode }, acquired });
      yield* worktrees.prepare({ intent: { operationId: samePlace, projectId, repository, destination, mode }, acquired });
      yield* worktrees.prepare({
        intent: { operationId: sameRef, projectId, repository, destination: paths.join(home, 'other'), mode },
        acquired,
      });
      const hook = paths.join(main, '.git', 'hooks', 'post-checkout');
      yield* files.writeFileString(hook, '#!/bin/sh\necho ran > "$PWD/hook.txt"\nexit 3\n');
      yield* files.chmod(hook, 0o755);

      const uncertain = yield* worktrees.execute({ operationId: made, projectId, acquired });

      expect(uncertain.status).toBe('uncertain');
      expect(uncertain.rootId).toBe(null);
      expect(uncertain.evidence?.status).toBe(3);
      expect(uncertain.evidence?.destination).toBe('present');
      expect(yield* files.readFileString(paths.join(destination, 'hook.txt'))).toBe('ran\n');
      expect(yield* worktrees.execute({ operationId: made, projectId, acquired })).toEqual(uncertain);
      const never = yield* Effect.flip(
        worktrees.adopt({
          recovery: {
            projectId,
            operationId: sameRef,
            revision: WorktreeRevision.make(0),
            observed: yield* seen(destination, paths.join(main, '.git', 'worktrees', 'side')),
          },
          acquired,
        }),
      );
      expect(never._tag).toBe('WorktreeRefused');
      if (never._tag === 'WorktreeRefused') expect(never.reason).toBe('unreserved');

      for (const [operationId, reason] of [
        [samePlace, 'destination-occupied'],
        [sameRef, 'ref-occupied'],
      ] as const) {
        const refused = yield* Effect.flip(worktrees.execute({ operationId, projectId, acquired }));
        expect(refused._tag).toBe('WorktreeRefused');
        if (refused._tag === 'WorktreeRefused') expect(refused.reason).toBe(reason);
      }
      expect((yield* worktrees.read(samePlace, projectId)).reserved).toBe(false);

      const resolved = yield* worktrees.prepareRecovery({ operationId: made, projectId, observed: destination, acquired });

      expect(resolved.subjects).toEqual({
        namespaceId,
        repository,
        destination: { namespaceId, path: destination },
        ref: 'refs/heads/side',
      });
      expect(resolved.observed.path).toBe(destination);
      expect(resolved.observed.gitDirectory).toBe(paths.join(main, '.git', 'worktrees', 'side'));
      expect(resolved.operation.revision).toBe(uncertain.revision);
      expect(yield* worktrees.read(made, projectId)).toEqual(uncertain);

      const stale = yield* Effect.flip(
        worktrees.adopt({
          recovery: { projectId, operationId: made, revision: WorktreeRevision.make(0), observed: resolved.observed },
          acquired,
        }),
      );
      expect(stale._tag).toBe('WorktreeRefused');
      if (stale._tag === 'WorktreeRefused') expect(stale.reason).toBe('stale-revision');
      const stranger = yield* Effect.flip(
        worktrees.adopt({
          recovery: {
            projectId,
            operationId: made,
            revision: uncertain.revision,
            observed: { ...resolved.observed, path: main },
          },
          acquired,
        }),
      );
      expect(stranger._tag).toBe('WorktreeRefused');
      if (stranger._tag === 'WorktreeRefused') expect(stranger.reason).toBe('observed-mismatch');
      const bypass = yield* Effect.flip(
        roots.register({
          path: destination,
          provenance: { kind: 'project', id: String(projectId) },
        }),
      );
      expect(bypass._tag).toBe('RootConflict');
      if (bypass._tag === 'RootConflict') {
        expect(bypass.reason).toBe('reserved');
        expect(bypass.message).toContain(made);
      }
      expect((yield* roots.resolveFootprint(destination)).roots).toEqual([]);

      const raced = yield* Effect.all(
        [
          Effect.result(
            worktrees.adopt({
              recovery: { projectId, operationId: made, revision: uncertain.revision, observed: resolved.observed },
              acquired,
            }),
          ),
          Effect.result(
            worktrees.adopt({
              recovery: { projectId, operationId: made, revision: uncertain.revision, observed: resolved.observed },
              acquired,
            }),
          ),
        ],
        { concurrency: 2 },
      );
      expect(raced.map((one) => one._tag)).toEqual(['Success', 'Success']);
      const adopted = yield* worktrees.read(made, projectId);

      expect(adopted.status).toBe('ready');
      expect(adopted.evidence).toEqual(uncertain.evidence);
      if (adopted.rootId === null) return yield* Effect.die('an adopted creation names no root');
      const root = yield* roots.read(adopted.rootId);
      expect(root.path).toBe(destination);
      expect(root.provenance).toEqual({ kind: 'worktree-recovered', id: made });
      expect(root.git?.repositoryId).toBe(store.repositoryId);
      expect((yield* roots.resolveFootprint(destination)).roots.map((one) => [one.root.rootId, one.relation])).toEqual([
        [adopted.rootId, 'equal'],
      ]);
      expect(yield* Effect.map(worktreesOf(git, main), (list) => list.map((one) => one.path))).toEqual([main, destination]);
      expect(yield* files.readFileString(paths.join(destination, 'hook.txt'))).toBe('ran\n');
      expect(
        yield* worktrees.adopt({
          recovery: { projectId, operationId: made, revision: uncertain.revision, observed: resolved.observed },
          acquired,
        }),
      ).toEqual(adopted);
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a name is released only where the producer provably ended, and never by deleting anything', () =>
    Effect.gen(function* () {
      const { files, paths, git, db, units, home, acquired, roots, records, grown, projectId, repositories, operations, worktrees } =
        yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const destination = paths.join(home, 'side');
      const creating = (args: readonly string[]): boolean => args.some((word, at) => word === 'worktree' && args[at + 1] === 'add');
      const lost: Git['Service'] = {
        run: (args, options) =>
          creating(args) ? Effect.flatMap(files.stat(paths.join(home, 'never')), () => git.run(args, options)) : git.run(args, options),
      };
      const unlucky = yield* worktreeCreator({
        intents: operations,
        records: operations,
        repositories,
        roots: yield* rootRegistry(records, files, paths, roots.namespaceId, operations),
        git: lost,
        files,
        paths,
        units,
      });
      const vanished = RequestKey.make('vanished');
      const mode = { kind: 'new-branch', branch: 'side', start: 'main' } as const;
      yield* unlucky.prepare({ intent: { operationId: vanished, projectId, repository, destination, mode }, acquired });

      const lostRun = yield* unlucky.execute({ operationId: vanished, projectId, acquired });

      expect(lostRun.status).toBe('uncertain');
      expect(lostRun.evidence?.ended).toBe('lost');
      expect(lostRun.evidence?.status).toBe(null);
      expect(lostRun.evidence?.message).not.toBe('');
      const given = yield* unlucky.abandon({
        operationId: vanished,
        projectId,
        revision: lostRun.revision,
        reason: 'nothing here read its end',
        acquired,
      });
      expect(given.abandonment).not.toBe(null);
      const contender = RequestKey.make('contender');
      yield* unlucky.prepare({
        intent: { operationId: contender, projectId, repository, destination, mode: { kind: 'detached', start: 'main' } },
        acquired,
      });
      expect((yield* worktrees.execute({ operationId: contender, projectId, acquired })).status).toBe('ready');

      const never = RequestKey.make('never-started');
      const unstartable = yield* worktreeCreator({
        intents: operations,
        records: operations,
        repositories,
        roots: yield* rootRegistry(records, files, paths, roots.namespaceId, operations),
        git: {
          run: (args, options) =>
            creating(args) ? Effect.fail(new GitUnavailable({ command: args, reason: 'no git on this path' })) : git.run(args, options),
        },
        files,
        paths,
        units,
      });
      yield* unstartable.prepare({
        intent: {
          operationId: never,
          projectId,
          repository,
          destination: paths.join(home, 'never'),
          mode: { kind: 'new-branch', branch: 'never', start: 'main' },
        },
        acquired,
      });

      const proved = yield* unstartable.execute({ operationId: never, projectId, acquired });

      expect(proved.status).toBe('failed');
      expect(proved.evidence?.status).toBe(null);
      expect(proved.evidence?.destination).toBe('absent');
      expect(proved.evidence?.retained).toBe(null);
      const settled = yield* Effect.flip(
        unstartable.abandon({
          operationId: never,
          projectId,
          revision: proved.revision,
          reason: 'nothing ran',
          acquired,
        }),
      );
      expect(settled._tag).toBe('WorktreeRefused');
      if (settled._tag === 'WorktreeRefused') expect(settled.reason).toBe('settled');

      const stranger = projectId + 1000;
      for (const refusal of [
        yield* Effect.flip(unlucky.execute({ operationId: vanished, projectId: stranger, acquired })),
        yield* Effect.flip(unlucky.read(vanished, stranger)),
      ]) {
        expect(refusal._tag).toBe('WorktreeRefused');
        if (refusal._tag === 'WorktreeRefused') expect(refusal.reason).toBe('foreign-project');
      }
    }).pipe(Effect.provide(storage)),
  );

  it.effect('an interrupted creation records that this server ended the run, and the name is releasable', () =>
    Effect.gen(function* () {
      const { files, paths, git, db, units, home, acquired, roots, records, grown, projectId, repositories, operations } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const operationId = RequestKey.make('cut-short');
      const started = yield* Deferred.make<void>();
      const hanging = yield* worktreeCreator({
        intents: operations,
        records: operations,
        repositories,
        roots: yield* rootRegistry(records, files, paths, roots.namespaceId, operations),
        git: {
          run: (args, options) =>
            creating(args) ? Effect.andThen(Deferred.succeed(started, undefined), Effect.never) : git.run(args, options),
        },
        files,
        paths,
        units,
      });
      yield* hanging.prepare({
        intent: {
          operationId,
          projectId,
          repository,
          destination: paths.join(home, 'side'),
          mode: { kind: 'new-branch', branch: 'side', start: 'main' },
        },
        acquired,
      });

      const running = yield* Effect.forkScoped(hanging.execute({ operationId, projectId, acquired }));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(running);

      const ended = yield* hanging.read(operationId, projectId);
      expect(ended.status).toBe('uncertain');
      expect(ended.evidence?.ended).toBe('terminated');
      expect(ended.evidence?.status).toBe(null);
      expect(ended.evidence?.retained).toBe(null);
      expect(
        (yield* hanging.abandon({
          operationId,
          projectId,
          revision: ended.revision,
          reason: 'the request was cancelled',
          acquired,
        })).abandonment,
      ).toBe('the request was cancelled');
    }).pipe(Effect.provide(storage)),
  );

  it.effect('an act whose producer is gone is reconciled; one this installation authorized is not', () =>
    Effect.gen(function* () {
      const { files, paths, git, db, units, home, acquired, roots, records, grown, projectId, repositories, operations } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const operationId = RequestKey.make('orphaned');
      const started = yield* Deferred.make<void>();
      const registry = () => rootRegistry(records, files, paths, roots.namespaceId, operations);
      const gone = yield* worktreeCreator({
        intents: operations,
        records: operations,
        repositories,
        roots: yield* registry(),
        git: {
          run: (args, options) =>
            creating(args) ? Effect.andThen(Deferred.succeed(started, undefined), Effect.never) : git.run(args, options),
        },
        files,
        paths,
        units,
      });
      const afterwards = yield* worktreeCreator({
        intents: operations,
        records: operations,
        repositories,
        roots: yield* registry(),
        git,
        files,
        paths,
        units,
      });
      yield* gone.prepare({
        intent: {
          operationId,
          projectId,
          repository,
          destination: paths.join(home, 'side'),
          mode: { kind: 'new-branch', branch: 'side', start: 'main' },
        },
        acquired,
      });
      yield* Effect.forkScoped(gone.execute({ operationId, projectId, acquired }));
      yield* Deferred.await(started);
      const held = yield* gone.read(operationId, projectId);

      const itself = yield* Effect.flip(gone.reconcile({ operationId, projectId, acquired }));
      expect(itself._tag).toBe('WorktreeRefused');
      if (itself._tag === 'WorktreeRefused') expect(itself.reason).toBe('unreconciled');
      expect((yield* gone.read(operationId, projectId)).evidence).toBe(null);

      const reconciled = yield* afterwards.reconcile({ operationId, projectId, acquired });

      expect(reconciled.status).toBe('uncertain');
      expect(reconciled.evidence?.ended).toBe('lost');
      if (held.producer === null) return yield* Effect.die('a reserved act names no producer');
      expect(reconciled.evidence?.message).toContain(held.producer);
      yield* afterwards.abandon({
        operationId,
        projectId,
        revision: reconciled.revision,
        reason: 'its installation is gone',
        acquired,
      });
      const after = RequestKey.make('after');
      yield* afterwards.prepare({
        intent: {
          operationId: after,
          projectId,
          repository,
          destination: paths.join(home, 'side'),
          mode: { kind: 'detached', start: 'main' },
        },
        acquired,
      });
      expect((yield* afterwards.execute({ operationId: after, projectId, acquired })).status).toBe('ready');
    }).pipe(Effect.provide(storage)),
  );

  it.effect('an act whose producer ended releases its name, keeps its work, and never runs again', () =>
    Effect.gen(function* () {
      const { files, paths, git, home, acquired, roots, seen, grown, projectId, repositories, worktrees } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const repository = { repositoryId: store.repositoryId, locationRevision: store.locationRevision };
      const destination = paths.join(home, 'side');
      const operationId = RequestKey.make('given-up');
      yield* worktrees.prepare({
        intent: { operationId, projectId, repository, destination, mode: { kind: 'new-branch', branch: 'side', start: 'main' } },
        acquired,
      });
      const hook = paths.join(main, '.git', 'hooks', 'post-checkout');
      yield* files.writeFileString(hook, '#!/bin/sh\nrm -rf "$PWD"\nexit 9\n');
      yield* files.chmod(hook, 0o755);
      const uncertain = yield* worktrees.execute({ operationId, projectId, acquired });
      expect(uncertain.evidence?.status).toBe(9);
      const branch = yield* run(git, main, ['rev-parse', 'refs/heads/side']);
      const listed = yield* Effect.map(worktreesOf(git, main), (list) => list.map((one) => one.path));

      const given = yield* worktrees.abandon({
        operationId,
        projectId,
        revision: uncertain.revision,
        reason: 'the checkout is gone and the branch is not',
        acquired,
      });

      expect(given.abandonment).toBe('the checkout is gone and the branch is not');
      expect(given.status).toBe('uncertain');
      expect(given.evidence).toEqual(uncertain.evidence);
      expect(yield* run(git, main, ['rev-parse', 'refs/heads/side'])).toBe(branch);
      expect(yield* Effect.map(worktreesOf(git, main), (list) => list.map((one) => one.path))).toEqual(listed);
      expect((yield* roots.resolveFootprint(main)).roots).toEqual([]);
      expect(yield* worktrees.execute({ operationId, projectId, acquired })).toEqual(given);
      for (const refusal of [
        yield* Effect.flip(worktrees.prepareRecovery({ operationId, projectId, observed: destination, acquired })),
        yield* Effect.flip(
          worktrees.adopt({
            recovery: {
              projectId,
              operationId,
              revision: given.revision,
              observed: yield* seen(main, paths.join(main, '.git')),
            },
            acquired,
          }),
        ),
      ]) {
        expect(refusal._tag).toBe('WorktreeRefused');
        if (refusal._tag === 'WorktreeRefused') expect(refusal.reason).toBe('abandoned');
      }
      expect(
        yield* worktrees.abandon({
          operationId,
          projectId,
          revision: given.revision,
          reason: 'again',
          acquired,
        }),
      ).toEqual(given);
      const after = RequestKey.make('after');
      yield* worktrees.prepare({
        intent: { operationId: after, projectId, repository, destination, mode: { kind: 'detached', start: 'main' } },
        acquired,
      });
      yield* files.remove(paths.join(main, '.git', 'hooks', 'post-checkout'));
      const met = yield* Effect.flip(worktrees.execute({ operationId: after, projectId, acquired }));
      expect(met._tag).toBe('WorktreeRefused');
      if (met._tag === 'WorktreeRefused') expect(met.reason).toBe('destination-occupied');
      expect((yield* worktrees.read(after, projectId)).reserved).toBe(false);
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a target replaced between the resolution and the act is refused, and registers nothing', () =>
    Effect.gen(function* () {
      const { files, paths, git, home, acquired, roots, grown, projectId, repositories, worktrees } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const destination = paths.join(home, 'side');
      const operationId = RequestKey.make('replaced-target');
      yield* worktrees.prepare({
        intent: {
          operationId,
          projectId,
          repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
          destination,
          mode: { kind: 'new-branch', branch: 'side', start: 'main' },
        },
        acquired,
      });
      const hook = paths.join(main, '.git', 'hooks', 'post-checkout');
      yield* files.writeFileString(hook, '#!/bin/sh\nexit 4\n');
      yield* files.chmod(hook, 0o755);
      const uncertain = yield* worktrees.execute({ operationId, projectId, acquired });
      expect(uncertain.status).toBe('uncertain');

      const resolved = yield* worktrees.prepareRecovery({ operationId, projectId, observed: destination, acquired });

      yield* files.remove(hook);
      yield* run(git, main, ['worktree', 'remove', '--force', destination]);
      yield* run(git, main, ['worktree', 'add', '-q', '--detach', destination, 'main']);

      const refused = yield* Effect.flip(
        worktrees.adopt({
          recovery: { projectId, operationId, revision: uncertain.revision, observed: resolved.observed },
          acquired,
        }),
      );

      expect(refused._tag).toBe('WorktreeRefused');
      if (refused._tag === 'WorktreeRefused') expect(refused.reason).toBe('observed-changed');
      expect((yield* roots.resolveFootprint(destination)).roots).toEqual([]);
      expect(yield* worktrees.read(operationId, projectId)).toEqual(uncertain);
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a hook that removes what was made is uncertain over the branch and registration it left', () =>
    Effect.gen(function* () {
      const { files, paths, git, db, home, acquired, namespaceId, grown, projectId, repositories, worktrees } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const destination = paths.join(home, 'side');
      const operationId = RequestKey.make('self-erasing');
      yield* worktrees.prepare({
        intent: {
          operationId,
          projectId,
          repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
          destination,
          mode: { kind: 'new-branch', branch: 'side', start: 'main' },
        },
        acquired,
      });
      const hook = paths.join(main, '.git', 'hooks', 'post-checkout');
      yield* files.writeFileString(hook, '#!/bin/sh\nrm -rf "$PWD"\nexit 7\n');
      yield* files.chmod(hook, 0o755);

      const outcome = yield* worktrees.execute({ operationId, projectId, acquired });

      expect(outcome.status).toBe('uncertain');
      expect(outcome.evidence?.destination).toBe('absent');
      expect(outcome.evidence?.retained).toEqual(['ref', 'registration']);
      expect(outcome.evidence?.unproven).toBe(null);
      expect(outcome.evidence?.message).not.toBe('');
      expect(yield* run(git, main, ['rev-parse', '--verify', 'refs/heads/side'])).not.toBe('');
      const listed = yield* Effect.map(worktreesOf(git, main), (list) => list.find((one) => one.path === destination));
      expect(listed?.prunable).not.toBe(null);
      const nothing = yield* Effect.flip(
        worktrees.prepareRecovery({
          operationId,
          projectId,
          observed: destination,
          acquired,
        }),
      );
      expect(nothing._tag).toBe('WorktreeRefused');
      if (nothing._tag === 'WorktreeRefused') expect(nothing.reason).toBe('observed-mismatch');
      expect((yield* worktrees.read(operationId, projectId)).status).toBe('uncertain');

      const after = RequestKey.make('after');
      yield* worktrees.prepare({
        intent: {
          operationId: after,
          projectId,
          repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
          destination,
          mode: { kind: 'detached', start: 'main' },
        },
        acquired,
      });
      const held = yield* Effect.flip(worktrees.execute({ operationId: after, projectId, acquired }));
      expect(held._tag).toBe('WorktreeRefused');
      if (held._tag === 'WorktreeRefused') expect(held.reason).toBe('destination-occupied');
      expect((yield* worktrees.read(after, projectId)).reserved).toBe(false);

      const { root: elsewhere } = yield* grown('elsewhere');
      yield* run(git, elsewhere, ['worktree', 'add', '-q', '-b', 'guest', destination]);

      const foreign = yield* Effect.flip(
        worktrees.prepareRecovery({
          operationId,
          projectId,
          observed: destination,
          acquired,
        }),
      );

      expect(foreign._tag).toBe('WorktreeRefused');
      if (foreign._tag === 'WorktreeRefused') expect(foreign.reason).toBe('observed-mismatch');
      const registered = yield* db.select().from(repository).where(eq(repository.namespaceId, namespaceId));
      expect(registered.map((row) => row.commonDirectory)).toEqual([paths.join(main, '.git')]);
    }).pipe(Effect.provide(storage)),
  );

  it.effect('a store replaced between the two phases refuses before anything is reserved', () =>
    Effect.gen(function* () {
      const { files, paths, home, acquired, grown, born, projectId, repositories, worktrees } = yield* fixture;
      const { root: main } = yield* grown('main');
      const store = yield* repositories.register({ path: main, projectId });
      const operationId = RequestKey.make('overtaken');
      const prepared = yield* worktrees.prepare({
        intent: {
          operationId,
          projectId,
          repository: { repositoryId: store.repositoryId, locationRevision: store.locationRevision },
          destination: paths.join(home, 'side'),
          mode: { kind: 'new-branch', branch: 'side', start: 'main' },
        },
        acquired,
      });

      yield* files.remove(paths.join(main, '.git'), { recursive: true });
      yield* born('main');

      const refused = yield* Effect.flip(worktrees.execute({ operationId, projectId, acquired }));

      expect(refused._tag).toBe('RepositoryConflict');
      if (refused._tag === 'RepositoryConflict') expect(refused.reason).toBe('replaced');
      expect(yield* worktrees.read(operationId, projectId)).toEqual(prepared.operation);
      expect(yield* files.exists(paths.join(home, 'side'))).toBe(false);
    }).pipe(Effect.provide(storage)),
  );
});
