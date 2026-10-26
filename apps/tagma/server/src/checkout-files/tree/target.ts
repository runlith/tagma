import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CheckoutPaths, type CheckoutPlace } from '../../workspace/contract/service/checkoutPaths.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { LooseRefusal } from '../contract/service/documents.js';

export type TargetRefusal = 'path-outside-tree' | 'graph-path' | 'files';

export type LooseFile = { readonly abs: string; readonly dir: string; readonly name: string };

const looseFile = (real: string): LooseFile => ({ abs: real, dir: dirname(real), name: basename(real) });

export type Target = {
  readonly relative: string;
  readonly abs: string;
  readonly real: string;
  readonly key: string;
};

const GIT = '.git';

const ROOTS_KEPT = 256;

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

const inside = (root: string, path: string): string | null =>
  path === root ? '' : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;

const outside = (path: string, why: string): GateRefusal<TargetRefusal> =>
  new GateRefusal('path-outside-tree', `${path} ${why}`, ['name a path inside the checkout']);

const realOrNull = (path: string): Effect.Effect<string | null> => Effect.promise(() => realpath(path).catch(() => null));

const standsAt = (path: string): Effect.Effect<'link' | 'entry' | null, GateRefusal<TargetRefusal>> =>
  Effect.flatMap(Effect.result(Effect.tryPromise({ try: () => lstat(path), catch: (cause) => cause })), (read) => {
    if (read._tag === 'Success') return Effect.succeed(read.success.isSymbolicLink() ? 'link' : 'entry');
    const code = codeOf(read.failure);
    if (code === 'ENOENT' || code === 'ENOTDIR') return Effect.succeed(null);
    return Effect.fail(new GateRefusal('files', `${path} could not be read: ${String(read.failure)}`, ['read the report and retry']));
  });

export const makeTargets = Effect.fnUntraced(function* (input: { readonly graph: string }) {
  const paths = yield* CheckoutPaths;
  const { graph } = input;
  const roots = new Map<string, string>();

  const rootOf = (place: ProjectRoot): Effect.Effect<string> =>
    Effect.suspend(() => {
      const known = roots.get(place.path);
      if (known !== undefined) return Effect.succeed(known);
      return Effect.map(realOrNull(place.path), (found) => {
        const root = found ?? place.path;
        if (roots.size >= ROOTS_KEPT) roots.clear();
        roots.set(place.path, root);
        return root;
      });
    });

  const guarded = (path: string, segments: readonly string[]): Effect.Effect<void, GateRefusal<TargetRefusal>> => {
    if (segments.includes(GIT)) return Effect.fail(outside(path, "is inside git's own directory"));
    if (segments[0] === graph) {
      return Effect.fail(
        new GateRefusal('graph-path', `${path} is the graph's own tree`, ['the graph is read and written through the graph operations']),
      );
    }
    return Effect.void;
  };

  const placed = (projectId: number, abs: string): Effect.Effect<CheckoutPlace | null, GateRefusal<'files'>> =>
    Effect.map(
      Effect.mapError(
        Effect.flatMap(paths.placeOf(projectId, abs), (own) => (own === null ? paths.placeAcross(abs) : Effect.succeed(own))),
        (failure) => new GateRefusal('files', `cannot place ${failure.path}: ${failure.reason}`, ['read the report and retry']),
      ),
      (place) => {
        if (place === null) return null;
        const segments = place.path.split('/');
        return segments.includes(GIT) || segments[0] === graph ? null : place;
      },
    );

  return {
    rootOf,

    placed,

    of: Effect.fnUntraced(function* (place: ProjectRoot, path: string, leaf: 'follow' | 'entry') {
      if (path.startsWith('/')) return yield* outside(path, 'is absolute: name it relative to the checkout root');
      const segments = path.split('/').filter((part) => part !== '' && part !== '.');
      if (segments.length === 0 || segments.includes('..')) return yield* outside(path, 'is not a path inside the checkout');
      yield* guarded(path, segments);
      const relative = segments.join('/');
      const confined = leaf === 'follow' ? relative : segments.slice(0, -1).join('/');
      if (confined !== '') {
        yield* Effect.mapError(paths.pathWithin(place.path, confined), (refused) =>
          refused.code === 'files'
            ? new GateRefusal('files', refused.reason, ['read the report and retry'])
            : outside(path, `leaves the checkout: ${refused.reason}`),
        );
      }
      const root = yield* rootOf(place);
      const spelled = join(root, relative);
      const parent = (yield* realOrNull(dirname(spelled))) ?? dirname(spelled);
      const named = join(parent, segments.at(-1) as string);
      let resolved = named;
      if (leaf === 'follow' && (yield* standsAt(named)) === 'link') {
        const followed = yield* realOrNull(named);
        if (followed === null) return yield* outside(path, 'is a link whose target does not exist');
        resolved = followed;
      }
      const key = inside(root, resolved);
      if (key === null || key === '') return yield* outside(path, 'resolves outside the checkout');
      yield* guarded(path, key.split('/'));
      return { relative, abs: join(place.path, key), real: root, key } satisfies Target;
    }),

    loose: Effect.fnUntraced(function* (projectId: number, path: string) {
      if (!isAbsolute(path)) {
        return yield* new GateRefusal('path-relative', `${path} is relative`, ['name the file by its absolute path']);
      }
      const spelled = resolve(path);
      const real = (yield* realOrNull(spelled)) ?? join((yield* realOrNull(dirname(spelled))) ?? dirname(spelled), basename(spelled));
      for (const one of new Set([spelled, real])) {
        if ((yield* placed(projectId, one)) !== null) {
          return yield* new GateRefusal('in-checkout', `${path} belongs to a checkout of a project on this machine`, [
            'open it through document.subscribe and save it with write_document, naming its checkout',
          ]);
        }
      }
      return looseFile(real);
    }),
  };
});

export type Targets = Effect.Success<ReturnType<typeof makeTargets>>;
