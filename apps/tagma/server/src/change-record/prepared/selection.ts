import { isAbsolute, resolve } from 'node:path';
import { Effect } from 'effect';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { CallPlace, CallerAim, SubjectProject } from '../../platform/contract/service/place.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Holdings } from '../contract/service/holdings.js';
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
  const checkouts = yield* (yield* Holdings)
    .heldCheckouts([caller.actor.threadId])
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
  const roots = yield* Effect.forEach(checkouts, (checkout) => registry.read(RootId.make(checkout))).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('root-unproven', failure.message, [
          'name checkout explicitly to select a readable checkout',
          'read the unavailable held checkouts again',
        ]),
    ),
  );
  const several = (paths: readonly string[]) =>
    new GateRefusal('multiple-checkouts', `This session holds lines in several checkouts: ${paths.join(', ')}.`, [
      'split the work into one checkout per call, naming checkout in each call',
    ]);
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
