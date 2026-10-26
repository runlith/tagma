import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { syncTopology } from './topology.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { markerText } from './marker.js';
import { shippedSteps } from '../steps/sequence.js';
import { twinWorld, twinWorldLayer, unheld } from '../testing/twins.js';

layer(twinWorldLayer, { excludeTestServices: true })('graph branch twins', (it) => {
  it.effect('forks from the current graph of its base rather than merged or adjacent siblings, then releases the world', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* Effect.scoped(
        Effect.gen(function* () {
          const { base, project, treeOf, sync, checkout, commit, write, sh } = yield* twinWorld();
          yield* sync(project);
          yield* write(project, 'doctrine');
          const merger = yield* checkout('merger', 'main');
          yield* sync(merger);
          yield* commit(project, 'later');
          const merged = yield* sh(['commit-tree', 'main^{tree}', '-p', 'merger', '-p', 'main', '-m', 'take main'], project);
          yield* sh(['read-tree', '-u', '-m', 'HEAD', 'main'], merger);
          yield* sh(['update-ref', 'refs/heads/merger', merged], project);
          const sibling = yield* checkout('sibling', 'main');
          yield* sync(sibling);
          yield* commit(sibling, 'own');
          const law = yield* write(project, 'release-law');
          const fresh = yield* checkout('fresh', 'main');
          expect((yield* sync(fresh)).forkedFrom).toBe('main');
          expect(yield* fs.readFileString(join(treeOf(fresh), 'release-law.md'))).toBe(law);
          return base;
        }),
      );
      expect(yield* fs.exists(base)).toBe(false);
    }),
  );

  it.effect('prefers a late-synced base over the branch that fast-forwarded through its code work', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, treeOf, sync, checkout, commit, write, sh } = yield* twinWorld();
      yield* sync(project);
      yield* write(project, 'doctrine');
      const release = yield* checkout('release', 'main');
      yield* commit(release, 'before-graph');
      yield* sync(release);
      const law = yield* write(release, 'release-law');
      yield* sh(['read-tree', '-u', '-m', 'HEAD', 'release'], project);
      yield* sh(['update-ref', 'refs/heads/main', 'release'], project);
      yield* commit(project, 'after');
      const fresh = yield* checkout('fresh', 'release');
      expect((yield* sync(fresh)).forkedFrom).toBe('release');
      expect(yield* fs.readFileString(join(treeOf(fresh), 'release-law.md'))).toBe(law);
    }),
  );

  it.effect('merges a levelled twin but keeps the target marker at the earlier step so the target still advances', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, checkout, commit, write, sh, level } = yield* twinWorld();
      yield* sync(project);
      yield* write(project, 'doctrine');
      const feature = yield* checkout('feature', 'main');
      yield* sync(feature);
      const note = yield* write(feature, 'feature-note');
      yield* commit(feature, 'feature');
      yield* sh(['merge', '--no-ff', '-m', 'merge feature', 'feature'], project);
      yield* syncTopology(shadow, project, treeOf(project), shippedSteps, { treeHold: unheld, level });
      expect(yield* fs.readFileString(join(treeOf(project), 'feature-note.md'))).toBe(note);
      expect(yield* fs.readFileString(join(treeOf(project), FORMAT_FILE))).toBe(markerText(null));
    }),
  );

  it.effect('merges a levelled twin into a target at the last step without lowering its marker to the unlevelled branch', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, checkout, commit, write, sh, level } = yield* twinWorld();
      yield* sync(project);
      yield* write(project, 'doctrine');
      const feature = yield* checkout('feature', 'main');
      yield* sync(feature);
      yield* fs.writeFileString(join(treeOf(feature), FORMAT_FILE), markerText(null));
      yield* write(feature, 'feature-note');
      yield* commit(feature, 'feature');
      yield* fs.writeFileString(join(treeOf(project), FORMAT_FILE), markerText(shippedSteps.last));
      yield* shadow.commitAct(treeOf(project), 'graph steps');
      yield* sh(['merge', '--no-ff', '-m', 'merge feature', 'feature'], project);
      yield* syncTopology(shadow, project, treeOf(project), shippedSteps, { treeHold: unheld, level });
      expect(yield* fs.readFileString(join(treeOf(project), FORMAT_FILE))).toBe(markerText(shippedSteps.last));
    }),
  );
});
