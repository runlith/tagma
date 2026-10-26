import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { scanTree } from '../../../graph/testing/doubles.js';
import { doorFixture, DoorFixture } from '../doorFixture.js';

layer(doorFixture(), { excludeTestServices: true })('projects door', (it) => {
  it.effect('a stealth project in a folder without git births its tree, root block and shadow, and creates no git there', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const root = yield* world.directory('stealth');
      const name = world.uniqueName();
      const created = yield* world.op('add_project', { name, rootPath: root, storage: 'stealth' });
      expect(created.status).toBe(200);
      const projectId = (created.body as { project: { id: number } }).project.id;
      const served = yield* world.runtime.pool.resolve({ projectId });
      expect(served.layout.mode).toBe('stealth');
      const scan = yield* scanTree(served.layout.treeRoot);
      expect(scan.blocks.map((entry) => entry.frontmatter.title)).toContain(name);
      expect(served.layout.treeRoot.startsWith(join(world.dataHome, 'graphs', name))).toBe(true);
      expect(existsSync(join(root, '.tagma'))).toBe(false);
      expect(existsSync(join(root, '.git'))).toBe(false);
      expect((yield* served.shadow!.log(served.layout.treeRoot)).length).toBeGreaterThan(0);
    }),
  );
});
