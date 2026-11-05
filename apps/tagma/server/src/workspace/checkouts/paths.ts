import { Effect, Semaphore } from 'effect';
import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { confineToTree } from '../roots/proof.js';
import { CheckoutPaths, type CheckoutPlace, type PathWithinRefusal, PlaceUnread } from '../contract/service/checkoutPaths.js';
import { Coverage, FileRoots } from '../contract/service/roots.js';
import type { ProjectRoot } from '../contract/wire/coverage.js';
import { Projects } from '../../projects/contract/service/registry.js';

const unreadPlace = (path: string, cause: unknown): PlaceUnread =>
  new PlaceUnread({ path, reason: cause instanceof Error ? cause.message : String(cause) });

interface PathUnread {
  readonly _tag: 'PathUnread';
  readonly cause: unknown;
}

const reading = <A>(run: () => Promise<A>): Effect.Effect<A, PathUnread> =>
  Effect.tryPromise({ try: run, catch: (cause) => ({ _tag: 'PathUnread' as const, cause }) });

const isMissing = (cause: unknown): boolean => {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const unread =
  (verb: string, path: string) =>
  (failure: PathUnread): GateRefusal<'files'> =>
    new GateRefusal('files', `cannot ${verb} ${path}: ${failure.cause instanceof Error ? failure.cause.message : String(failure.cause)}`, [
      'read the report and retry',
    ]);

function canonicalize(absolute: string): Effect.Effect<string, PathUnread> {
  const parts = absolute.split('/');
  const upTo = (end: number): Effect.Effect<string, PathUnread> =>
    Effect.suspend(() => {
      if (end <= 1) return Effect.succeed(absolute);
      const prefix = parts.slice(0, end).join('/') || '/';
      const rest = parts.slice(end).join('/');
      return reading(() => realpath(prefix)).pipe(
        Effect.map((resolved) => (rest === '' ? resolved : `${resolved.replace(/\/+$/, '')}/${rest}`)),
        Effect.catch((failure) => (isMissing(failure.cause) ? upTo(end - 1) : Effect.fail(failure))),
      );
    });
  return upTo(parts.length);
}

const stands = (path: string): Effect.Effect<boolean, PathUnread> =>
  reading(() => stat(path)).pipe(
    Effect.as(true),
    Effect.catch((failure) => (isMissing(failure.cause) ? Effect.succeed(false) : Effect.fail(failure))),
  );

const outside = (path: string): GateRefusal<PathWithinRefusal> =>
  new GateRefusal('path-outside-tree', `path escapes the served tree: ${path}`, ['ask for a path inside the served tree']);

const spelled = Effect.fn('CheckoutPaths.spelled')(function* (absolute: string): Effect.fn.Return<string, PathUnread> {
  const parent = yield* canonicalize(dirname(absolute));
  const named = join(parent, basename(absolute));
  const entry = yield* reading(() => lstat(named)).pipe(
    Effect.map((info) => (info.isDirectory() ? info : null)),
    Effect.catch((failure) => (isMissing(failure.cause) ? Effect.succeed(null) : Effect.fail(failure))),
  );
  if (entry === null) return named;
  const real = yield* reading(() => realpath(named));
  return dirname(real) === parent ? real : named;
});

const deepestRoot = (roots: readonly ProjectRoot[], path: string): ProjectRoot | null => {
  let found: ProjectRoot | null = null;
  for (const root of roots) {
    if (path !== root.path && !path.startsWith(`${root.path}/`)) continue;
    if (found === null || root.path.length > found.path.length) found = root;
  }
  return found;
};

const placeIn = (root: ProjectRoot, path: string): CheckoutPlace => ({
  projectId: root.projectId,
  checkout: root.rootId,
  root: root.path,
  path: path === root.path ? '' : path.slice(root.path.length + 1),
});

const ofOneProject = (
  matches: readonly ProjectRoot[],
  preferred: number | null,
  path: string,
  checkout: string,
): Effect.Effect<readonly ProjectRoot[], PlaceUnread> => {
  const projects = [...new Set(matches.map((root) => root.projectId))];
  if (projects.length <= 1) return Effect.succeed(matches);
  if (preferred !== null && projects.includes(preferred)) return Effect.succeed(matches.filter((root) => root.projectId === preferred));
  return Effect.fail(new PlaceUnread({ path, reason: `checkout ${checkout} belongs to projects ${projects.join(', ')}` }));
};

const OUTSIDE_KEPT = 1024;

const addRoot = (index: Map<string, readonly ProjectRoot[]>, key: string, root: ProjectRoot): void => {
  const group = index.get(key) ?? [];
  if (!group.some((one) => one.projectId === root.projectId && one.rootId === root.rootId)) index.set(key, [...group, root]);
};

const dropProject = (index: Map<string, readonly ProjectRoot[]>, key: string, projectId: number): void => {
  const remaining = (index.get(key) ?? []).filter((one) => one.projectId !== projectId);
  if (remaining.length === 0) index.delete(key);
  else index.set(key, remaining);
};

const directlyIn = (outside: ReadonlySet<string> | undefined, path: string): boolean => outside?.has(dirname(path)) === true;

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

export type CheckoutPathService = CheckoutPaths['Service'];

export const makeCheckoutPathService = Effect.gen(function* () {
  const coverage = yield* Coverage;
  const projects = yield* Projects;
  const fileRoots = yield* FileRoots;

  const removed = (root: ProjectRoot, path: string) =>
    fileRoots.removed(root.rootId).pipe(Effect.mapError((failure) => unreadPlace(path, failure)));

  const retained = (roots: readonly ProjectRoot[], path: string) =>
    Effect.filter(roots, (root) => Effect.map(removed(root, path), (gone) => !gone));

  const deepest = Effect.fnUntraced(function* (roots: readonly ProjectRoot[], path: string) {
    const candidates = roots.filter((root) => under(path, root.path)).sort((a, b) => b.path.length - a.path.length);
    for (const root of candidates) if (!(yield* removed(root, path))) return placeIn(root, path);
    return null;
  });

  const indexedRoot = Effect.fnUntraced(function* (
    roots: ReadonlyMap<string, readonly ProjectRoot[]>,
    path: string,
    preferred: number | null,
  ) {
    for (let directory = path; ; directory = dirname(directory)) {
      const matches = yield* retained(roots.get(directory) ?? [], path);
      if (matches.length > 0) return deepestRoot(yield* ofOneProject(matches, preferred, path, directory), path);
      if (directory === dirname(directory)) return null;
    }
  });

  const known = new Map<number, readonly ProjectRoot[]>();

  const outsideOf = new Map<number, Set<string>>();

  let seenRegistry = -1;

  let invalidations = 0;

  let projectsAt: ReadonlyMap<number, string> = new Map();

  const byPath = new Map<string, readonly ProjectRoot[]>();

  const byId = new Map<string, readonly ProjectRoot[]>();

  const pending = new Set<number>();

  const revisions = new Map<number, number>();

  const building = Semaphore.makeUnsafe(1);

  const missedAcross = new Set<string>();

  const fenced = new Map<number, readonly string[]>();

  const former = new Map<number, readonly string[]>();

  function invalidate(projectId: number): void {
    const roots = known.get(projectId) ?? [];
    if (roots.length > 0) former.set(projectId, [...new Set([...(former.get(projectId) ?? []), ...roots.map((root) => root.path)])]);
    for (const root of roots) {
      dropProject(byPath, root.path, projectId);
      dropProject(byId, root.rootId, projectId);
    }
    known.delete(projectId);
    outsideOf.delete(projectId);
    fenced.delete(projectId);
    pending.add(projectId);
    missedAcross.clear();
    invalidations += 1;
    revisions.set(projectId, (revisions.get(projectId) ?? 0) + 1);
  }

  const refreshRegistry = Effect.fnUntraced(function* (path: string) {
    const registry = yield* projects.registryVersion;
    if (registry !== seenRegistry) {
      const listed = yield* projects.list().pipe(Effect.mapError((failure) => unreadPlace(path, failure)));
      const current = new Map(listed.map((project) => [project.id, project.rootPath] as const));
      for (const [projectId, root] of projectsAt) if (current.get(projectId) !== root) invalidate(projectId);
      for (const projectId of known.keys()) if (!current.has(projectId)) invalidate(projectId);
      for (const [projectId, root] of current) {
        if (projectsAt.get(projectId) === root) continue;
        if (known.has(projectId)) invalidate(projectId);
        else pending.add(projectId);
      }
      for (const projectId of former.keys()) if (!current.has(projectId)) former.delete(projectId);
      projectsAt = current;
      seenRegistry = registry;
      missedAcross.clear();
    }
    return registry;
  });

  function machineRoots(path: string): Effect.Effect<ReadonlyMap<string, readonly ProjectRoot[]>, PlaceUnread> {
    return building.withPermit(
      Effect.gen(function* () {
        for (;;) {
          const registry = yield* refreshRegistry(path);
          const revision = invalidations;
          for (const projectId of pending) {
            if (projectsAt.has(projectId) && !known.has(projectId)) yield* rootsOf(projectId, path, true);
          }
          if (revision !== invalidations || (yield* projects.registryVersion) !== registry) continue;
          pending.clear();
          return byPath;
        }
      }),
    );
  }

  const widened = (path: string, spelling: string) =>
    coverage.coverAcross(spelling).pipe(Effect.mapError((failure) => unreadPlace(path, failure)));

  const atSpelling = Effect.fn('CheckoutPaths.atSpelling')(function* (
    path: string,
    spelling: string,
    preferred: number | null,
    followed = false,
  ): Effect.fn.Return<ProjectRoot | null, PlaceUnread> {
    const roots = yield* machineRoots(path);
    const placed = yield* indexedRoot(roots, spelling, preferred);
    for (const [projectId, fences] of fenced) {
      const root = fences.find((one) => under(spelling, one));
      if (root === undefined || (placed !== null && placed.path.length > root.length)) continue;
      yield* rootsOf(projectId, path);
      pending.add(projectId);
      fenced.delete(projectId);
      return yield* atSpelling(path, spelling, preferred, followed);
    }
    if (placed !== null || followed) return placed;
    if (yield* widened(path, spelling)) return yield* atSpelling(path, spelling, preferred, true);
    if (directlyIn(missedAcross, spelling)) return placed;
    const moved = yield* coverage.followAcross(spelling).pipe(Effect.mapError((failure) => unreadPlace(path, failure)));
    if (moved) return yield* atSpelling(path, spelling, preferred, true);
    if (missedAcross.size >= OUTSIDE_KEPT) missedAcross.clear();
    missedAcross.add(dirname(spelling));
    return null;
  });

  function missed(projectId: number, directory: string): void {
    const outside = outsideOf.get(projectId) ?? new Set<string>();
    if (outside.size >= OUTSIDE_KEPT) outside.clear();
    outside.add(directory);
    outsideOf.set(projectId, outside);
  }

  function rootsOf(projectId: number, path: string, across = false): Effect.Effect<readonly ProjectRoot[], PlaceUnread> {
    return Effect.suspend(() => {
      const attempted = revisions.get(projectId) ?? 0;
      let omitted = false;
      let place: string | undefined;
      const fence = (refusal: PlaceUnread): Effect.Effect<readonly ProjectRoot[], PlaceUnread> => {
        const registered = projectsAt.get(projectId);
        const fences = [
          ...new Set([
            ...(place === undefined ? [] : [place]),
            ...(registered === undefined ? [] : [registered]),
            ...(former.get(projectId) ?? []),
          ]),
        ];
        if (!across || fences.length === 0 || fences.some((root) => under(path, root))) return Effect.fail(refusal);
        return Effect.map(
          Effect.mapError(Effect.forEach(fences, canonicalize), () => refusal),
          (real) => {
            omitted = true;
            if ((revisions.get(projectId) ?? 0) === attempted) fenced.set(projectId, real);
            return [];
          },
        );
      };
      return coverage.covered(projectId).pipe(
        Effect.catchTag('ProjectRootsUnavailable', (failure) =>
          failure.reason === 'unestablished' || failure.reason === 'moved' ? coverage.cover(projectId) : Effect.fail(failure),
        ),
        Effect.map((covered) => covered.roots),
        Effect.mapError((failure) => {
          place = 'path' in failure && typeof failure.path === 'string' ? failure.path : undefined;
          return new PlaceUnread({ path, reason: failure.message });
        }),
        Effect.catchTag('PlaceUnread', fence),
        Effect.flatMap((roots) => {
          return Effect.forEach(roots, (root) =>
            Effect.map(
              Effect.mapError(canonicalize(root.path), (failure) => unreadPlace(root.path, failure.cause)),
              (real) => ({ ...root, path: real }),
            ),
          ).pipe(
            Effect.tap((roots) =>
              Effect.sync(() => {
                if (omitted || (revisions.get(projectId) ?? 0) !== attempted) return;
                fenced.delete(projectId);
                former.delete(projectId);
                for (const root of known.get(projectId) ?? []) {
                  dropProject(byPath, root.path, projectId);
                  dropProject(byId, root.rootId, projectId);
                }
                known.set(projectId, roots);
                for (const root of roots) {
                  addRoot(byPath, root.path, root);
                  addRoot(byId, root.rootId, root);
                }
              }),
            ),
          );
        }),
      );
    });
  }

  coverage.onCovered((projectId) => invalidate(projectId));

  return CheckoutPaths.of({
    placeAcross: (path) =>
      Effect.flatMap(
        Effect.mapError(spelled(path), (failure) => unreadPlace(path, failure.cause)),
        (spelling) => Effect.map(atSpelling(path, spelling, null), (root) => (root === null ? null : placeIn(root, spelling))),
      ),

    resourceAcross: (path) =>
      Effect.flatMap(
        Effect.mapError(canonicalize(path), (failure) => unreadPlace(path, failure.cause)),
        (spelling) => Effect.map(atSpelling(path, spelling, null), (root) => (root === null ? null : placeIn(root, spelling))),
      ),

    rootAcross: Effect.fnUntraced(function* (named, preferred) {
      const absolute = isAbsolute(named);
      const spelling = absolute ? yield* Effect.mapError(canonicalize(named), (failure) => unreadPlace(named, failure.cause)) : named;
      if (preferred !== null) {
        const local = yield* building.withPermit(
          Effect.gen(function* () {
            for (;;) {
              const registry = yield* refreshRegistry(named);
              if (!projectsAt.has(preferred)) return null;
              const revision = revisions.get(preferred) ?? 0;
              if (!known.has(preferred)) yield* rootsOf(preferred, named, true);
              if ((revisions.get(preferred) ?? 0) !== revision || (yield* projects.registryVersion) !== registry) continue;
              const matches = absolute ? byPath.get(spelling) : byId.get(named);
              return (yield* retained(matches?.filter((root) => root.projectId === preferred) ?? [], named))[0] ?? null;
            }
          }),
        );
        if (local !== null) return local;
      }
      if (!absolute) {
        yield* machineRoots(named);
        return (yield* ofOneProject(yield* retained(byId.get(named) ?? [], named), preferred, named, named))[0] ?? null;
      }
      return yield* atSpelling(named, spelling, preferred);
    }),

    rootsWithin: Effect.fn('CheckoutPaths.rootsWithin')(function* (directory) {
      const spelling = yield* Effect.mapError(spelled(directory), (failure) => unreadPlace(directory, failure.cause));
      const roots = yield* machineRoots(directory);
      for (const [projectId, fences] of [...fenced]) {
        if (fences.some((root) => under(root, spelling) || under(spelling, root))) yield* rootsOf(projectId, directory);
      }
      const prefix = spelling.endsWith('/') ? spelling : `${spelling}/`;
      const within: CheckoutPlace[] = [];
      for (const [path, group] of roots) {
        if (!path.startsWith(prefix)) continue;
        for (const root of yield* retained(group, directory)) within.push(placeIn(root, path));
      }
      return within;
    }),

    placeOf: Effect.fn('CheckoutPaths.placeOf')(function* (projectId, path) {
      const spelling = yield* Effect.mapError(spelled(path), (failure) => unreadPlace(path, failure.cause));
      const held = known.get(projectId);
      const placed = held === undefined ? null : yield* deepest(held, spelling);
      if (placed !== null) return placed;
      if (yield* widened(path, spelling)) {
        const covered = yield* deepest(yield* rootsOf(projectId, path), spelling);
        if (covered !== null) return covered;
      }
      if (held !== undefined && directlyIn(outsideOf.get(projectId), spelling)) return null;
      const found = yield* deepest(yield* rootsOf(projectId, path), spelling);
      if (found !== null) return found;
      const followed = yield* Effect.mapError(
        coverage.follow(projectId, spelling),
        (failure) => new PlaceUnread({ path, reason: failure.message }),
      );
      const after = followed ? yield* deepest(yield* rootsOf(projectId, path), spelling) : null;
      if (after === null) missed(projectId, dirname(spelling));
      return after;
    }),

    pathWithin: Effect.fn('CheckoutPaths.pathWithin')(function* (root, path) {
      const absolute = isAbsolute(path) ? path : confineToTree(root, path);
      if (absolute === null) return yield* outside(path);
      const resolving = unread('resolve', path);
      const anchored = yield* Effect.mapError(
        reading(() => realpath(root)),
        resolving,
      );
      const canonical = yield* Effect.mapError(canonicalize(absolute), resolving);
      if (confineToTree(anchored, canonical) === null) return yield* outside(path);
      return { exists: yield* Effect.mapError(stands(canonical), unread('stat', path)) };
    }),
  });
});
