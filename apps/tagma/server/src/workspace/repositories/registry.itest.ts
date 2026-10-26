import { layer } from '@runlith/effect-test';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Clock, Deferred, Effect, Fiber, FileSystem, Layer, Option, Path, PlatformError } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { storeAt } from '@runlith/git/repository';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { repository } from '../store/tables.js';
import { project } from '../../projects/store/table.js';
import { RepositoryId } from '../contract/wire/repositories.js';
import { makeRepositoryStore } from '../store/repositories.js';
import { makeRepositoryRegistry } from './registry.js';

const namespaceId = NamespaceId.make('test-repositories');
const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const layers = Layer.mergeAll(storage, BunFileSystem.layer, Path.layer, gitLayer.pipe(Layer.provide(host)));
const run = (git: Git['Service'], cwd: string, args: readonly string[]): Effect.Effect<string> =>
  Effect.orDie(
    Effect.flatMap(git.run(args, { cwd }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(`git ${args.join(' ')} in ${cwd}: ${answer.stderr}`),
    ),
  );

const fixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const git = yield* Git;
  const { db } = yield* MachineStore;
  yield* db.delete(repository).where(eq(repository.namespaceId, namespaceId));
  const records = yield* makeRepositoryStore({ db });
  const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'repositories-' }));
  const born = Effect.fn(function* (name: string) {
    const root = paths.join(home, name);
    yield* files.makeDirectory(root, { recursive: true });
    yield* run(git, root, ['init', '-q', '-b', 'main']);
    return root;
  });
  const commit = Effect.fn(function* (root: string) {
    yield* run(git, root, ['-c', 'user.email=git@test', '-c', 'user.name=git', 'commit', '-q', '--allow-empty', '-m', 'born']);
    return yield* run(git, root, ['rev-parse', 'HEAD']);
  });
  const registrar = Effect.fn(function* (name: string) {
    const row = yield* db
      .insert(project)
      .values({
        name: `${home}/${name}`,
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
    records,
    home,
    born,
    commit,
    registrar,
    projectId: yield* registrar('registrar'),
    repositories: yield* makeRepositoryRegistry({ store: records, namespaceId }),
  };
});

layer(layers, { excludeTestServices: true })('repository registry', (it) => {
  it.effect('linked worktrees share one store, a second clone is another, and re-registration adds none', () =>
    Effect.gen(function* () {
      const { files, git, paths, home, born, commit, projectId, registrar, repositories, records } = yield* fixture;
      const main = yield* born('main');
      const head = yield* commit(main);
      const linked = paths.join(home, 'linked');
      yield* run(git, main, ['worktree', 'add', '-q', '-b', 'side', linked]);
      const clone = paths.join(home, 'clone');
      yield* run(git, home, ['clone', '-q', main, clone]);
      const store = yield* repositories.register({ path: main, projectId });
      const worktree = yield* repositories.register({ path: linked, projectId });
      const second = yield* repositories.register({ path: clone, projectId });
      expect(worktree.repositoryId).toBe(store.repositoryId);
      expect(second.repositoryId).not.toBe(store.repositoryId);
      expect(store.commonDirectory).toBe(paths.join(main, '.git'));
      expect(store.projectId).toBe(projectId);
      expect(store.locationRevision).toBe(LocationRevision.make(0));
      const deep = paths.join(linked, 'inner', 'deep');
      yield* files.makeDirectory(deep, { recursive: true });
      expect((yield* repositories.register({ path: deep, projectId })).repositoryId).toBe(store.repositoryId);
      expect((yield* repositories.register({ path: store.commonDirectory, projectId })).repositoryId).toBe(store.repositoryId);
      const privateDir = paths.join(main, '.git', 'worktrees', paths.basename(linked));
      expect((yield* repositories.register({ path: privateDir, projectId })).repositoryId).toBe(store.repositoryId);
      const standing = yield* repositories.read(store.repositoryId);
      expect(standing.bare).toBe(false);
      expect(standing.head).toEqual({ ref: 'refs/heads/main', commit: head });
      expect((yield* repositories.base(store.repositoryId)).commit).toBe(head);
      const guest = yield* repositories.register({ path: main, projectId: yield* registrar('guest') });
      expect(guest.repositoryId).toBe(store.repositoryId);
      expect(guest.projectId).toBe(projectId);
      expect((yield* records.candidates(namespaceId, store.commonDirectory, store.witness)).map((row) => row.repositoryId)).toEqual([
        store.repositoryId,
      ]);
      expect((yield* Effect.flip(repositories.read(RepositoryId.make('never-registered'))))._tag).toBe('RepositoryMissing');
    }),
  );

  it.effect('a changed or vanished common directory refuses with what was expected and found, and never merges', () =>
    Effect.gen(function* () {
      const { files, paths, born, commit, projectId, repositories } = yield* fixture;
      const read = yield* born('read');
      yield* commit(read);
      const written = yield* born('written');
      yield* commit(written);
      const first = yield* repositories.register({ path: read, projectId });
      const other = yield* repositories.register({ path: written, projectId });
      for (const root of [read, written]) {
        yield* files.remove(paths.join(root, '.git'), { recursive: true });
        yield* born(paths.basename(root));
      }
      const stale = yield* Effect.flip(repositories.read(first.repositoryId));
      expect(stale._tag).toBe('RepositoryConflict');
      if (stale._tag === 'RepositoryConflict') {
        expect(stale.reason).toBe('replaced');
        expect(stale.expected).toBe(first.witness.token);
        expect(stale.found).not.toBe(first.witness.token);
        expect(stale.commonDirectory).toBe(first.commonDirectory);
      }
      const replacement = yield* repositories.register({ path: written, projectId });
      expect(replacement.repositoryId).not.toBe(other.repositoryId);
      expect(replacement.commonDirectory).toBe(other.commonDirectory);
      const recorded = yield* Effect.flip(repositories.read(other.repositoryId));
      expect(recorded._tag).toBe('RepositoryConflict');
      if (recorded._tag === 'RepositoryConflict') expect(recorded.reason).toBe('replaced');
      expect((yield* repositories.register({ path: written, projectId })).repositoryId).toBe(replacement.repositoryId);
      const after = yield* repositories.register({ path: read, projectId });
      yield* files.remove(after.commonDirectory, { recursive: true });
      expect((yield* Effect.flip(repositories.read(after.repositoryId)))._tag).toBe('RepositoryMissing');
    }),
  );

  it.effect('a common directory that has become another store\u2019s is refused, not read through', () =>
    Effect.gen(function* () {
      const { files, paths, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const aside = yield* born('aside');
      yield* commit(aside);
      const registered = yield* repositories.register({ path: aside, projectId });
      yield* files.writeFileString(paths.join(aside, '.git', 'commondir'), `${paths.join(main, '.git')}\n`);
      const stale = yield* Effect.flip(repositories.read(registered.repositoryId));
      expect(stale._tag).toBe('RepositoryConflict');
      if (stale._tag === 'RepositoryConflict') {
        expect(stale.reason).toBe('replaced');
        expect(stale.expected).toBe(registered.commonDirectory);
        expect(stale.found).toBe(paths.join(main, '.git'));
      }
    }),
  );

  it.effect('two registrations of one store racing each other converge on one record', () =>
    Effect.gen(function* () {
      const { paths, home, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const linked = paths.join(home, 'linked');
      yield* run(yield* Git, main, ['worktree', 'add', '-q', '-b', 'side', linked]);
      const raced = yield* Effect.all(
        [
          Effect.result(repositories.register({ path: main, projectId })),
          Effect.result(repositories.register({ path: linked, projectId })),
          Effect.result(repositories.register({ path: paths.join(main, '.git'), projectId })),
        ],
        { concurrency: 3 },
      );
      const winner = yield* repositories.register({ path: main, projectId });
      for (const outcome of raced) {
        expect(outcome._tag === 'Success' ? outcome.success.repositoryId : outcome.failure).toBe(winner.repositoryId);
      }
    }),
  );

  it.effect('a registration whose candidates moved before its final unit refuses instead of writing', () =>
    Effect.gen(function* () {
      const { files, paths, db, home, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const standing = yield* repositories.register({ path: main, projectId });
      const units = yield* MachineUnits;
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const store = yield* Effect.provideService(makeRepositoryStore({ db }), MachineUnits, {
        ...units,
        write: (operation, job) =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(resume)), Effect.andThen(units.write(operation, job))),
      });
      const contender = yield* makeRepositoryRegistry({ store, namespaceId });
      const pending = yield* Effect.forkScoped(Effect.result(contender.register({ path: main, projectId })));
      yield* Deferred.await(entered);
      yield* files.rename(paths.join(main, '.git'), paths.join(home, 'carried-off'));
      yield* born('main');
      const stranger = yield* repositories.register({ path: main, projectId });
      expect(stranger.repositoryId).not.toBe(standing.repositoryId);
      yield* Deferred.succeed(resume, undefined);
      const refused = yield* Fiber.join(pending);
      expect(refused._tag).toBe('Failure');
      if (refused._tag === 'Failure') {
        expect(refused.failure._tag).toBe('RepositoryConflict');
        if (refused.failure._tag === 'RepositoryConflict') expect(refused.failure.reason).toBe('registry-changed');
      }
    }),
  );

  it.effect('bare and unborn stores register and read as themselves, and offer no base object', () =>
    Effect.gen(function* () {
      const { git, paths, home, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      const head = yield* commit(main);
      const mirror = paths.join(home, 'mirror.git');
      yield* run(git, home, ['clone', '-q', '--bare', main, mirror]);
      const empty = yield* born('empty');
      const hollow = paths.join(home, 'hollow.git');
      yield* run(git, home, ['init', '-q', '--bare', '-b', 'main', hollow]);
      const bare = yield* repositories.read((yield* repositories.register({ path: mirror, projectId })).repositoryId);
      expect(bare.bare).toBe(true);
      expect(bare.repository.commonDirectory).toBe(mirror);
      expect(bare.head.commit).toBe(head);
      for (const root of [empty, hollow]) {
        const registered = yield* repositories.register({ path: root, projectId });
        const standing = yield* repositories.read(registered.repositoryId);
        expect(standing.head.commit).toBe(null);
        expect(standing.head.ref).toBe('refs/heads/main');
        expect(standing.bare).toBe(root === hollow);
        const refused = yield* Effect.flip(repositories.base(registered.repositoryId));
        expect(refused._tag).toBe('RepositoryBaseMissing');
        if (refused._tag === 'RepositoryBaseMissing') expect(refused.ref).toBe('refs/heads/main');
      }
    }),
  );

  it.effect('a store that moved is named by registration and taken only by relocation', () =>
    Effect.gen(function* () {
      const { files, paths, home, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const aside = yield* born('aside');
      yield* commit(aside);
      const registered = yield* repositories.register({ path: main, projectId });
      const elsewhere = paths.join(home, 'elsewhere');
      yield* files.rename(main, elsewhere);
      yield* files.symlink(elsewhere, main);
      for (const met of [
        yield* Effect.flip(repositories.register({ path: elsewhere, projectId })),
        yield* Effect.flip(repositories.read(registered.repositoryId)),
      ]) {
        expect(met._tag).toBe('RepositoryConflict');
        if (met._tag === 'RepositoryConflict') {
          expect(met.reason).toBe('moved');
          expect(met.repositoryId).toBe(registered.repositoryId);
          expect(met.registered).toBe(registered.commonDirectory);
          expect(met.found).toBe(paths.join(elsewhere, '.git'));
        }
      }
      const mismatch = yield* Effect.flip(
        repositories.relocate({ repositoryId: registered.repositoryId, locationRevision: registered.locationRevision }, aside),
      );
      expect(mismatch._tag).toBe('RepositoryConflict');
      if (mismatch._tag === 'RepositoryConflict') expect(mismatch.reason).toBe('binding-mismatch');
      const relocated = yield* repositories.relocate(
        { repositoryId: registered.repositoryId, locationRevision: registered.locationRevision },
        elsewhere,
      );
      expect(relocated.repositoryId).toBe(registered.repositoryId);
      expect(relocated.commonDirectory).toBe(paths.join(elsewhere, '.git'));
      expect(relocated.locationRevision).toBe(LocationRevision.make(1));
      expect((yield* Effect.flip(repositories.read(registered.repositoryId, LocationRevision.make(0))))._tag).toBe('RepositoryConflict');
      expect((yield* repositories.read(registered.repositoryId, LocationRevision.make(1))).repository).toEqual(relocated);
      expect((yield* repositories.register({ path: elsewhere, projectId })).repositoryId).toBe(registered.repositoryId);
    }),
  );

  it.effect('a reading of a taken address does not decide the fate of the store that left it', () =>
    Effect.gen(function* () {
      const { files, paths, home, born, commit, projectId, repositories } = yield* fixture;
      const roots = new Map<string, string>();
      for (const name of ['read-first', 'write-first']) {
        const root = yield* born(name);
        yield* commit(root);
        roots.set(name, root);
      }
      const registered = new Map(
        yield* Effect.forEach([...roots], ([name, root]) =>
          Effect.map(repositories.register({ path: root, projectId }), (record) => [name, record] as const),
        ),
      );
      const moved = new Map<string, string>();
      for (const [name, root] of roots) {
        const to = paths.join(home, `${name}-moved`);
        yield* files.rename(root, to);
        moved.set(name, to);
        yield* born(name);
      }
      const left = registered.get('read-first')!;
      const stale = yield* Effect.flip(repositories.read(left.repositoryId));
      expect(stale._tag).toBe('RepositoryConflict');
      if (stale._tag === 'RepositoryConflict') expect(stale.reason).toBe('replaced');
      const met = yield* Effect.flip(repositories.register({ path: moved.get('read-first')!, projectId }));
      expect(met._tag).toBe('RepositoryConflict');
      if (met._tag === 'RepositoryConflict') expect(met.repositoryId).toBe(left.repositoryId);
      const kept = yield* repositories.relocate(
        { repositoryId: left.repositoryId, locationRevision: left.locationRevision },
        moved.get('read-first')!,
      );
      expect(kept.repositoryId).toBe(left.repositoryId);
      expect((yield* repositories.read(kept.repositoryId, kept.locationRevision)).repository).toEqual(kept);
      const lost = registered.get('write-first')!;
      const stranger = yield* repositories.register({ path: roots.get('write-first')!, projectId });
      expect(stranger.repositoryId).not.toBe(lost.repositoryId);
      const afresh = yield* repositories.register({ path: moved.get('write-first')!, projectId });
      expect(afresh.repositoryId).not.toBe(lost.repositoryId);
      expect(afresh.repositoryId).not.toBe(stranger.repositoryId);
      const recorded = yield* Effect.flip(repositories.read(lost.repositoryId));
      expect(recorded._tag).toBe('RepositoryConflict');
      if (recorded._tag === 'RepositoryConflict') expect(recorded.reason).toBe('replaced');
    }),
  );

  it.effect('a registration witnessed in other terms stops the reading instead of replacing it', () =>
    Effect.gen(function* () {
      const { db, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const registered = yield* repositories.register({ path: main, projectId });
      yield* db.update(repository).set({ witnessFormat: 'stat-coordinate' }).where(eq(repository.repositoryId, registered.repositoryId));
      for (const refused of [
        yield* Effect.flip(repositories.read(registered.repositoryId)),
        yield* Effect.flip(repositories.register({ path: main, projectId })),
      ]) {
        expect(refused._tag).toBe('RepositoryInvalid');
        if (refused._tag === 'RepositoryInvalid') expect(refused.reason).toBe('identity-format');
      }
      const rows = yield* db.select().from(repository).where(eq(repository.namespaceId, namespaceId));
      expect(rows.map((row) => ({ id: row.repositoryId, state: row.state }))).toEqual([{ id: registered.repositoryId, state: 'active' }]);
    }),
  );

  it.effect('an absence is established, and a repository git will not open is never one', () =>
    Effect.gen(function* () {
      const { files, paths, home, records, projectId, repositories } = yield* fixture;
      const reason = Effect.fn(function* (path: string) {
        const refused = yield* Effect.flip(repositories.register({ path, projectId }));
        return refused._tag;
      });
      const plain = paths.join(home, 'plain');
      yield* files.makeDirectory(paths.join(plain, 'inner'), { recursive: true });
      expect(yield* reason(plain)).toBe('RepositoryMissing');
      expect(yield* reason(paths.join(plain, 'inner'))).toBe('RepositoryMissing');
      const link = paths.join(home, 'link');
      yield* files.makeDirectory(paths.join(link, 'inner'), { recursive: true });
      yield* files.writeFileString(paths.join(link, '.git'), `gitdir: ${paths.join(home, 'nowhere')}\n`);
      const gone = paths.join(home, 'gone-away');
      yield* files.makeDirectory(gone);
      yield* files.symlink(paths.join(home, 'nowhere'), paths.join(gone, '.git'));
      const hollow = paths.join(home, 'hollow');
      yield* files.makeDirectory(paths.join(hollow, '.git'), { recursive: true });
      const barish = paths.join(home, 'barish');
      yield* files.makeDirectory(paths.join(barish, 'objects'), { recursive: true });
      yield* files.makeDirectory(paths.join(barish, 'refs'), { recursive: true });
      yield* files.writeFileString(paths.join(barish, 'HEAD'), '');
      for (const place of [link, gone, hollow, barish]) expect(yield* reason(place)).toBe('RepositoryUnreadable');
      expect(yield* reason(paths.join(link, 'inner'))).toBe('RepositoryUnreadable');
      expect(yield* reason(paths.join(home, 'gone'))).toBe('RepositoryMissing');
      expect(yield* reason('relative')).toBe('RepositoryInvalid');
      const loop = paths.join(home, 'loop');
      yield* files.makeDirectory(loop);
      yield* files.symlink('.git', paths.join(loop, '.git'));
      expect(yield* reason(loop)).toBe('RepositoryUnreadable');
      const ordinary = paths.join(home, 'ordinary');
      yield* files.writeFileString(ordinary, 'not a directory');
      expect(yield* reason(ordinary)).toBe('RepositoryUnreadable');
      const marker = paths.join(plain, '.git');
      for (const method of ['exists', 'readLink'] as const) {
        const reader = yield* Effect.provideService(makeRepositoryRegistry({ store: records, namespaceId }), FileSystem.FileSystem, {
          ...files,
          [method]: (path: string) =>
            path === marker
              ? Effect.fail(PlatformError.systemError({ _tag: 'PermissionDenied', module: 'FileSystem', method }))
              : files[method](path),
        });
        const refused = yield* Effect.flip(reader.register({ path: plain, projectId }));
        expect(refused._tag).toBe('RepositoryUnavailable');
        if (refused._tag === 'RepositoryUnavailable') {
          expect(refused.reason).toBe('filesystem');
          expect(refused.path).toBe(marker);
        }
      }
    }),
  );

  it.effect('a repository git resolves from its environment is never read as the place asked for', () =>
    Effect.gen(function* () {
      const { files, git, paths, home, records, born, commit, projectId, repositories } = yield* fixture;
      const store = yield* born('store');
      yield* commit(store);
      const plain = paths.join(home, 'plain');
      yield* files.makeDirectory(plain);
      const under = Effect.fnUntraced(function* (variables: Record<string, string>) {
        const environment = { ...process.env, ...variables };
        const overridden = Git.of({ run: (args, options) => git.run(args, { ...options, env: environment }) });
        const registry = yield* Effect.provideService(
          makeRepositoryRegistry({ store: records, namespaceId, environment }),
          Git,
          overridden,
        );
        return { overridden, repositories: registry };
      });
      const resolved = yield* under({ GIT_DIR: paths.join(store, '.git') });
      expect((yield* storeAt(resolved.overridden, plain)).commonDir).toBe(paths.join(store, '.git'));
      for (const poisoned of [resolved, yield* under({ GIT_DIR: paths.join(home, 'nowhere') }), yield* under({ GIT_WORK_TREE: store })]) {
        const refused = yield* Effect.flip(poisoned.repositories.register({ path: plain, projectId }));
        expect(refused._tag).toBe('RepositoryRefused');
        if (refused._tag === 'RepositoryRefused') expect(refused.reason).toBe('discovery-overridden');
        expect((yield* Effect.flip(poisoned.repositories.register({ path: store, projectId })))._tag).toBe('RepositoryRefused');
      }
      expect((yield* Effect.flip(repositories.register({ path: plain, projectId }))).message).toContain('git found none');
      expect((yield* repositories.register({ path: store, projectId })).commonDirectory).toBe(paths.join(store, '.git'));
    }),
  );

  it.effect('one namespace does not answer for another\u2019s registration of the same store', () =>
    Effect.gen(function* () {
      const { records, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const elsewhere = yield* makeRepositoryRegistry({ store: records, namespaceId: NamespaceId.make('other-repositories') });
      const here = yield* repositories.register({ path: main, projectId });
      const there = yield* elsewhere.register({ path: main, projectId });
      expect(there.repositoryId).not.toBe(here.repositoryId);
      expect(there.commonDirectory).toBe(here.commonDirectory);
      expect((yield* Effect.flip(elsewhere.read(here.repositoryId)))._tag).toBe('RepositoryMissing');
      expect((yield* repositories.read(here.repositoryId)).repository).toEqual(here);
    }),
  );

  it.effect('a filesystem that supplies no birthtime registers and reads nothing', () =>
    Effect.gen(function* () {
      const { files, records, born, commit, projectId, repositories } = yield* fixture;
      const main = yield* born('main');
      yield* commit(main);
      const registered = yield* repositories.register({ path: main, projectId });
      const reader = yield* Effect.provideService(makeRepositoryRegistry({ store: records, namespaceId }), FileSystem.FileSystem, {
        ...files,
        stat: (path) => Effect.map(files.stat(path), (info) => ({ ...info, birthtime: Option.some(new Date(0)) })),
      });
      for (const refused of [
        yield* Effect.flip(reader.register({ path: main, projectId })),
        yield* Effect.flip(reader.read(registered.repositoryId)),
      ]) {
        expect(refused._tag).toBe('RepositoryUnavailable');
        if (refused._tag === 'RepositoryUnavailable') expect(refused.reason).toBe('identity-unavailable');
      }
      expect((yield* repositories.read(registered.repositoryId)).repository).toEqual(registered);
    }),
  );
});
