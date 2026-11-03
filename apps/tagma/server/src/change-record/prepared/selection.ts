import { isAbsolute, resolve } from 'node:path';
import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { CallPlace, CallerAim, SubjectProject } from '../../platform/contract/service/place.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Git } from '@runlith/git/Git';
import { Projects } from '../../projects/contract/service/registry.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { PreparedChanges } from '../contract/service/prepared.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { RootId } from '../../workspace/contract/wire/ids.js';

export const selectCheckout = Effect.fn('prepared.selectCheckout')(function* (
  input: { readonly project?: string | number; readonly checkout?: string },
  caller: Caller,
) {
  const paths = yield* CheckoutPaths;
  const locate = (root: string) =>
    paths.placeAcross(root).pipe(
      Effect.mapError((failure) => new GateRefusal('root-unproven', failure.reason, ['read the checkout again'])),
      Effect.flatMap((placed) =>
        placed === null || placed.path !== ''
          ? Effect.fail(new GateRefusal('root-unproven', `${root} is not a registered checkout root.`, ['name its checkout root']))
          : Effect.succeed({ projectId: placed.projectId, checkout: placed.root, branch: null }),
      ),
    );
  if (input.checkout !== undefined) {
    const workspace = yield* CallerWorkspace;
    if (workspace === null && !isAbsolute(input.checkout)) {
      return yield* new GateRefusal('root-unproven', 'A relative checkout needs a calling workspace.', ['name an absolute checkout root']);
    }
    return yield* locate(resolve(workspace?.root ?? '/', input.checkout));
  }
  const aim = yield* CallerAim;
  const subject = yield* SubjectProject;
  const aimed = aim?.cwd !== undefined || aim?.branch !== undefined;
  const main = Effect.fnUntraced(function* (projectId: number) {
    const project = yield* (yield* Projects).byId(projectId);
    return { projectId: project.id, checkout: project.rootPath, branch: null };
  });
  if (subject !== null) {
    const place = yield* CallPlace;
    if (aimed && place?.projectId === subject) return place;
  } else if (input.project !== undefined || aim?.project !== undefined || aimed) {
    const place = yield* CallPlace;
    if (place === null || aimed) return place;
    return yield* main(place.projectId);
  }
  if (caller.actor.kind !== 'thread') return subject === null ? null : yield* main(subject);
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const git = yield* Git;
  const changes = yield* PreparedChanges;
  const { team, checkouts } = yield* changes
    .teamCheckouts(units, store, { projectId: caller.actor.projectId, threadId: caller.actor.threadId })
    .pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('root-unproven', failure.message, [
            'name checkout explicitly to select a readable checkout',
            'read_changes and make the unavailable checkout readable',
          ]),
      ),
    );
  const registry = yield* FileRoots;
  const read = yield* Effect.forEach(checkouts, (checkout) => registry.read(RootId.make(checkout))).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('root-unproven', failure.message, [
          'name checkout explicitly to select a readable checkout',
          'read the unavailable held checkouts again',
        ]),
    ),
  );
  const standing = yield* Effect.forEach(read, (root, at) =>
    changes.remaining({ git, root: root.path, store, units, checkout: checkouts[at]! }, team).pipe(
      Effect.map((paths) => paths.length > 0),
      Effect.mapError(
        (failure) =>
          new GateRefusal(
            'root-unproven',
            `which files of this session still differ from HEAD in ${root.path} could not be read: ${failure.message}`,
            ['name checkout explicitly to select a readable checkout', 'read the unavailable checkout again'],
          ),
      ),
    ),
  );
  const roots = read.filter((_, at) => standing[at] === true);
  const several = (paths: readonly string[]) =>
    new GateRefusal(
      'multiple-checkouts',
      `This session and its finished children changed files in several checkouts: ${paths.join(', ')}.`,
      ['split the work into one checkout per call, naming checkout in each call'],
    );
  if (subject === null) {
    if (roots.length === 0) return null;
    if (roots.length > 1) return yield* several(roots.map((root) => root.path));
    return yield* locate(roots[0]!.path);
  }
  const placed = yield* Effect.forEach(roots, (root) => locate(root.path));
  const inScope = placed.filter((place) => place.projectId === subject);
  if (inScope.length === 0) return yield* main(subject);
  if (inScope.length > 1) return yield* several(inScope.map((place) => place.checkout));
  return inScope[0]!;
});
