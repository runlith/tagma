import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Documents } from '../contract/service/documents.js';
import { makeTargets } from '../tree/target.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { CheckoutPlaces } from '../../workspace/contract/service/checkouts.js';
import { fixedCheckoutPaths } from '../../workspace/testing/doubles.js';
import { forProject, inWorkspace } from '../../invocation/testing/call.js';
import { filesWorld, GRAPH, worldLayers } from '../testing/world.js';
import { FILE_PAIRS } from './pairs.js';

it.live(
  "place_path names the checkout, its root and the path inside it for an absolute path and for one read from the project checkout; a path no root holds, and one inside git's own directory, has no place",
  () =>
    Effect.gen(function* () {
      const { root, place, paths, files, write } = yield* filesWorld;
      yield* write('src/a.ts', 'export const a = 1;');
      const report = paths.join(root, '..', 'outside report.md');
      yield* files.writeFileString(report, '# Report');
      const targets = yield* makeTargets({ graph: GRAPH }).pipe(
        Effect.provideService(CheckoutPaths, yield* fixedCheckoutPaths(1, [{ checkout: place.rootId, root }])),
      );
      const placed = (input: { path: string; from?: string }) =>
        FILE_PAIRS.place_path.body.execute(input as never, undefined, undefined as never).pipe(
          forProject(Effect.succeed({ project: { id: 1 } } as never)),
          inWorkspace(null),
          Effect.provideService(Documents, { placeOf: targets.placed } as never),
          Effect.provideService(CheckoutPlaces, {
            rootOf: () => Effect.succeed(place.rootId),
            placeOf: () => Effect.succeed(place),
          } as never),
        );

      const absolute = yield* placed({ path: paths.join(root, 'src', 'a.ts') });
      expect(absolute).toMatchObject({
        status: 'ok',
        entry: { kind: 'file', path: paths.join(root, 'src/a.ts'), bytes: 19 },
        place: { checkout: place.rootId, root, path: 'src/a.ts' },
      });

      const relative = yield* placed({ path: 'src/a.ts' });
      expect(relative).toEqual(absolute);

      const outside = yield* placed({ path: '/definitely/elsewhere/x.ts' });
      expect(outside).toEqual({ status: 'ok', entry: null, place: null });
      expect(yield* placed({ path: report })).toMatchObject({ status: 'ok', entry: { kind: 'file', path: report, bytes: 8 }, place: null });
      expect(yield* placed({ path: '../outside report.md', from: root })).toEqual(yield* placed({ path: report }));
      expect(yield* placed({ path: 'src' })).toEqual({
        status: 'ok',
        entry: { kind: 'directory', path: paths.join(root, 'src') },
        place: { projectId: 1, checkout: place.rootId, root, path: 'src' },
      });
      const config = paths.join(root, '.git', 'config');
      expect(yield* placed({ path: config })).toMatchObject({ status: 'ok', entry: { kind: 'file', path: config }, place: null });
      expect(yield* placed({ path: paths.join(root, '.git') })).toEqual({
        status: 'ok',
        entry: { kind: 'directory', path: paths.join(root, '.git') },
        place: null,
      });
    }).pipe(Effect.provide(worldLayers)),
);
