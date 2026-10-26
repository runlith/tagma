import { expect } from 'bun:test';
import { shippedSteps } from '../steps/sequence.js';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { twinWorld, twinWorldLayer, unheld } from '../testing/twins.js';
import { ShadowGit } from './shadow.js';
import { syncTopology } from './topology.js';

layer(twinWorldLayer, { excludeTestServices: true })('cold checkout recovery', (it) => {
  it.effect('a removed code worktree releases its graph branch on cold sync without losing committed or draft knowledge', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const git = yield* Git;
      const { project, shadow, treeOf, sync, checkout, write, sh } = yield* twinWorld();
      yield* sync(project);
      const second = yield* checkout('release', 'main');
      yield* sync(second);
      const committed = yield* write(second, 'release-note', 'committed release knowledge');
      const draft = 'uncommitted knowledge stays here';
      yield* fs.writeFileString(join(treeOf(second), 'draft.md'), draft);
      yield* sh(['worktree', 'remove', second], project);
      yield* sh(['switch', 'release'], project);
      const reopened = yield* ShadowGit.open(shadow.gitDir, git, null);
      expect((yield* syncTopology(reopened, project, treeOf(project), shippedSteps, { treeHold: unheld })).branch).toBe('release');
      expect(yield* fs.readFileString(join(treeOf(project), 'release-note.md'))).toBe(committed);
      expect(yield* fs.readFileString(join(treeOf(second), 'draft.md'))).toBe(draft);
      expect(yield* sh(['rev-parse', '--abbrev-ref', 'HEAD'], treeOf(second))).toBe('HEAD');
    }),
  );
});
