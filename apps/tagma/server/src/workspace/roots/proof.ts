import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Option } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { isAbsolute, relative } from 'node:path';
import type { IdentityWitness } from '@runlith/files/namespace';
import { witnessOf } from '@runlith/files/witness';
import type { EnvironmentBinding } from '../contract/wire/environments.js';
import { Environments } from '../contract/service/environments.js';
import { WorkingOrigins } from '../contract/service/places.js';
import { WorkspaceGeneration } from '../contract/wire/ids.js';
import type { ProvedRoot, WorkOrigin, WorkingOrigin, PlacedPath, WorkingRoot } from '../contract/wire/place.js';
import { type CheckoutPaths, CheckoutUnknown, type PlaceUnread } from '../contract/service/checkoutPaths.js';

type Probed = {
  readonly environment: EnvironmentBinding;
  readonly address: string;
  readonly witness: IdentityWitness;
};

export function confineToTree(treeRoot: string, path: string): string | null {
  const root = treeRoot.replace(/\/+$/, '');
  if (root === '') return null;
  const parts: string[] = [];
  const input = path.startsWith('/') ? path : `${root}/${path}`;
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const resolved = `/${parts.join('/')}`;
  return resolved === root || resolved.startsWith(`${root}/`) ? resolved : null;
}

export const under = (root: string, at: string): string | null => {
  const rel = relative(root, at);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
  return rel === '' ? '.' : rel;
};

export const checkoutAt = (
  paths: CheckoutPaths['Service'],
  projectId: number,
  root: string,
): Effect.Effect<string, PlaceUnread | CheckoutUnknown> =>
  Effect.flatMap(paths.placeOf(projectId, root), (place) =>
    place !== null && place.path === ''
      ? Effect.succeed(place.checkout)
      : Effect.fail(new CheckoutUnknown({ path: root, reason: `no checkout of project ${projectId} stands at ${root}` })),
  );

export function placeIn(checkout: string, path: string): PlacedPath | null {
  return isAbsolute(path) ? null : { checkout, path };
}

export const placesIn = (checkout: string, paths: readonly string[]): readonly PlacedPath[] =>
  paths.flatMap((path) => {
    const place = placeIn(checkout, path);
    return place === null ? [] : [place];
  });

export type WorkingRootReader = {
  readonly rootOf: (root: string) => Effect.Effect<WorkingRoot | null>;
};

export const unprovenRoots: WorkingRootReader = { rootOf: () => Effect.succeed(null) };

export type HostRootProver = WorkingOrigins['Service'];

export const makeHostRootProver = Effect.gen(function* () {
  const access = yield* Environments;
  let host: EnvironmentBinding | null = null;

  const unproved = (failure: unknown) => Effect.as(Effect.logWarning('a working root could not be proved', { failure }), null);

  const environment: Effect.Effect<EnvironmentBinding | null> = Effect.suspend(() =>
    host !== null
      ? Effect.succeed(host)
      : access.inspect('host').pipe(
          Effect.map((state) => {
            if (state.binding !== null) host = state.binding;
            return state.binding;
          }),
          Effect.catchTags({
            EnvironmentUnavailable: unproved,
            EnvironmentReplaced: unproved,
            EnvironmentAccessDenied: unproved,
            EnvironmentUseConflict: unproved,
            ActivationUnsupported: unproved,
            EnvironmentRegistryUnavailable: unproved,
            EnvironmentUseMissing: unproved,
            EnvironmentUseResolved: unproved,
          }),
        ),
  );

  const prove = Effect.fn('WorkingOrigins.prove')(
    function* (root: string): Effect.fn.Return<Probed | null, PlatformError, FileSystem.FileSystem> {
      const binding = yield* environment;
      if (binding === null) return null;
      const files = yield* FileSystem.FileSystem;
      const address = yield* files.realPath(root);
      const info = yield* files.stat(address);
      if (info.type !== 'Directory') return null;
      const minted = witnessOf({
        type: info.type,
        inode: Option.getOrNull(info.ino),
        birthtime: Option.isNone(info.birthtime) ? null : info.birthtime.value.getTime(),
      });
      if (minted._tag === 'Failure') {
        switch (minted.failure) {
          case 'inode':
          case 'birthtime':
            return null;
        }
      }
      return { environment: binding, address, witness: minted.success };
    },
    Effect.provide(BunFileSystem.layer),
    Effect.catchTag('PlatformError', unproved),
  );

  const placeOf = (root: string): Effect.Effect<ProvedRoot | null> =>
    Effect.map(prove(root), (proven) =>
      proven === null
        ? null
        : {
            environment: proven.environment,
            root: { namespaceId: proven.environment.namespaceId, path: proven.address },
            witness: proven.witness,
            registration: null,
          },
    );

  const rootOf = (root: string): Effect.Effect<WorkingRoot | null> =>
    Effect.map(placeOf(root), (place) => (place === null ? null : { ...place, generation: WorkspaceGeneration.make(0) }));

  const of = (work: WorkOrigin, root: string): Effect.Effect<WorkingOrigin | null> =>
    Effect.map(rootOf(root), (place) => (place === null ? null : { ...place, work }));

  return WorkingOrigins.of({ of, rootOf, placeOf });
});
