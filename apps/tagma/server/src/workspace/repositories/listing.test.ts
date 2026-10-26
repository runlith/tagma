import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { Context, Effect, FileSystem, Layer, Path, PlatformError } from 'effect';
import { Git } from '@runlith/git/Git';
import { Projects } from '../../projects/contract/service/registry.js';
import { Coverage, FileRoots } from '../contract/service/roots.js';
import { Repositories } from '../contract/service/repositories.js';
import { RootId } from '../contract/wire/ids.js';
import type { FileRoot } from '../contract/wire/roots.js';
import { RepositoryId, RepositoryMissing, type RepositoryState } from '../contract/wire/repositories.js';
import { makeCoveredRepositoryReader } from './listing.js';

const namespaceId = NamespaceId.make('covered-repositories');
const unused = () => Effect.die('the covered repository reader must not mutate registrations');
const witness = { provider: 'test', format: 'identity', token: 'same-directory' };

const fixture = Effect.gen(function* () {
  const roots: FileRoot[] = [];
  const projects = new Map<number, RootId[]>();
  const states = new Map<RepositoryId, RepositoryState>();
  const canonical = new Map<string, string>([['/', '/']]);
  const membership = new Map<string, string>();
  const add = (projectId: number, path: string, repositoryId = RepositoryId.make(path)): FileRoot => {
    const root: FileRoot = {
      rootId: RootId.make(path),
      namespaceId,
      path,
      witness,
      locationRevision: LocationRevision.make(0),
      provenance: { kind: 'test', id: 'reader' },
      state: 'active',
      git: { repositoryId, gitDirectory: { namespaceId, path: `${path}/.git` } },
    };
    roots.push(root);
    projects.set(projectId, [...(projects.get(projectId) ?? []), root.rootId]);
    canonical.set(path, path);
    membership.set(path, `${path}/.git`);
    if (!states.has(repositoryId))
      states.set(repositoryId, {
        repository: {
          repositoryId,
          namespaceId,
          commonDirectory: `${path}/.git`,
          witness,
          projectId,
          locationRevision: LocationRevision.make(2),
          state: 'active',
        },
        bare: false,
        head: { ref: 'refs/heads/main', commit: 'committed-head' },
      });
    return root;
  };
  const coverage = Coverage.of({
    covered: (projectId) =>
      Effect.succeed({
        projectId,
        namespaceId,
        rootPath: '/',
        withheld: [],
        roots: (projects.get(projectId) ?? []).map((rootId) => ({ projectId, rootId, path: rootId, origin: 'canonical' as const })),
      }),
    cover: unused,
    adopt: unused,
    survey: unused,
    admit: unused,
    follow: unused,
    followAcross: unused,
    onCovered: () => () => undefined,
    recorded: () => undefined,
  });
  const registry = Repositories.of({
    read: (repositoryId) =>
      Effect.suspend(() => {
        const state = states.get(repositoryId);
        return state === undefined
          ? new RepositoryMissing({ repositoryId, namespaceId, message: 'the registered store is unavailable' })
          : Effect.succeed(state);
      }),
    at: (path) =>
      Effect.suspend(() => {
        const common = membership.get(path);
        return common === undefined ? Effect.die(`no git fact supplied at ${path}`) : Effect.succeed(common);
      }),
    register: unused,
    base: unused,
    relocate: unused,
  });
  const files = FileSystem.makeNoop({
    realPath: (path) =>
      Effect.suspend(() => {
        const real = canonical.get(path);
        return real === undefined
          ? Effect.fail(PlatformError.systemError({ _tag: 'NotFound', module: 'FileSystem', method: 'realPath', pathOrDescriptor: path }))
          : Effect.succeed(real);
      }),
  });
  const records = FileRoots.of({
    namespaceId,
    live: (ids) => Effect.succeed(roots.filter((root) => ids.includes(root.rootId))),
    register: unused,
    resolve: unused,
    publish: unused,
    publishAll: unused,
    read: unused,
    checked: unused,
    checkedAll: unused,
    active: unused,
    scope: () => ({ resolve: unused }),
    resolveFootprint: unused,
    recheck: unused,
    retireMissing: unused,
    removed: unused,
    locate: unused,
    probe: unused,
    matching: unused,
    relocate: unused,
  });
  const reader = yield* makeCoveredRepositoryReader.pipe(
    Effect.provide(Context.make(Coverage, coverage).pipe(Context.add(FileRoots, records), Context.add(Repositories, registry))),
    Effect.provideService(FileSystem.FileSystem, files),
    Effect.provide(Layer.mergeAll(Path.layer, Layer.mock(Projects, {}), Layer.mock(Git, {}))),
  );
  return { add, states, canonical, membership, reader, withdraw: (projectId: number) => projects.delete(projectId) };
});

it.effect('covered repositories group linked checkouts and expose the binding of the registered store', () =>
  Effect.gen(function* () {
    const { add, reader, membership } = yield* fixture;
    const main = add(1, '/main');
    add(1, '/linked', main.git!.repositoryId);
    membership.set('/linked', '/main/.git');
    expect(yield* reader.list(1)).toEqual({
      repositories: [
        {
          binding: { repositoryId: main.git!.repositoryId, locationRevision: LocationRevision.make(2) },
          commonDirectory: '/main/.git',
          bare: false,
          head: { ref: 'refs/heads/main', commit: 'committed-head' },
          checkouts: ['/linked', '/main'],
        },
      ],
      withheld: [],
    });
    expect((yield* reader.at(1, '/linked')).repositories[0]?.commonDirectory).toBe('/main/.git');
  }),
);

it.effect('coverage isolates projects and excludes nested repositories and paths outside the covered roots', () =>
  Effect.gen(function* () {
    const { add, reader, canonical, membership } = yield* fixture;
    const mine = add(1, '/mine');
    const theirs = add(2, '/theirs');
    canonical.set('/mine/vendor', '/mine/vendor');
    membership.set('/mine/vendor', '/mine/vendor/.git');
    expect((yield* reader.list(1)).repositories.map((row) => row.commonDirectory)).toEqual(['/mine/.git']);
    expect(yield* reader.at(1, '/mine/vendor')).toEqual({ repositories: [], withheld: [] });
    expect(yield* reader.at(1, '/theirs')).toEqual({ repositories: [], withheld: [] });
    expect(yield* reader.at(1, '/mine-sibling')).toEqual({ repositories: [], withheld: [] });
    expect(yield* reader.at(1, '/')).toEqual({ repositories: [], withheld: [] });
    expect(yield* reader.covers(1, mine.git!.repositoryId)).toBe(true);
    expect(yield* reader.covers(1, theirs.git!.repositoryId)).toBe(false);
  }),
);

it.effect('an unreadable covered store is withheld without losing the stores that still stand', () =>
  Effect.gen(function* () {
    const { add, reader, states } = yield* fixture;
    const lost = add(1, '/lost');
    add(1, '/kept');
    states.delete(lost.git!.repositoryId);
    const listed = yield* reader.list(1);
    expect(listed.repositories.map((row) => row.commonDirectory)).toEqual(['/kept/.git']);
    expect(listed.withheld).toEqual([{ repositoryId: lost.git!.repositoryId, reason: 'the registered store is unavailable' }]);
    expect(yield* reader.at(1, '/lost')).toEqual({ repositories: [], withheld: listed.withheld });
  }),
);

it.effect('canonical paths resolve symlinked prefixes and a missing suffix to the covered checkout', () =>
  Effect.gen(function* () {
    const { add, reader, canonical, membership } = yield* fixture;
    add(1, '/real');
    canonical.set('/alias', '/real');
    canonical.set('/alias/inner', '/real/inner');
    membership.set('/real/inner', '/real/.git');
    expect((yield* reader.at(1, '/alias')).repositories[0]?.checkouts).toEqual(['/real']);
    expect((yield* reader.at(1, '/alias/inner/missing')).repositories[0]?.commonDirectory).toBe('/real/.git');
    expect((yield* Effect.flip(reader.at(1, 'relative')))._tag).toBe('RepositoryInvalid');
  }),
);

it.effect('withdrawing coverage removes the repository even while its registration remains', () =>
  Effect.gen(function* () {
    const { add, reader, states, withdraw } = yield* fixture;
    add(1, '/covered');
    expect((yield* reader.list(1)).repositories).toHaveLength(1);
    withdraw(1);
    expect(states.size).toBe(1);
    expect(yield* reader.list(1)).toEqual({ repositories: [], withheld: [] });
    expect(yield* reader.covers(1, RepositoryId.make('/covered'))).toBe(false);
  }),
);
