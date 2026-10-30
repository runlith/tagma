import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { EnforcementReading } from '../../../enforcement/contract/wire/engines.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';

layer(doorFixture(), { excludeTestServices: true })('text-only rules', (it) => {
  it.effect('a foreign thread reads the rules of a graph whose folder has no git checkout', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const home = yield* world.stealthProject();
      const target = yield* world.plainProject();
      yield* projectLeaving(world, home, target);
      const roots = yield* world.op('list_root_blocks', {}, `project=${target}`);
      const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
      const created = yield* world.op(
        'create_block',
        { parentId, tags: ['rule'], title: 'Keep observations concrete' },
        `project=${target}`,
      );
      const rule = (created.body as { block: { name: string } }).block.name;
      const born = yield* world.op('create_thread', {}, `project=${home}`);
      const thread = (born.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      const doors = makeThreadDoors(world, home, ['read_enforcement']);
      const at = yield* doors.doorsFor(thread.id, thread.ownerId);
      const outcome = yield* doors.atNative('read_enforcement', { project: target, limit: 1 }, at);
      expect(outcome.class, outcome.class === 'refusal' ? `${outcome.code}: ${outcome.reason}` : '').toBe('answer');
      if (outcome.class !== 'answer') return;
      const reading = outcome.value as EnforcementReading;
      expect(reading.counts).toMatchObject({ rules: 1, enforced: 0, debt: 0, escaped: 0 });
      expect(reading.rules?.total).toBe(1);
      expect(reading.rules?.rows).toEqual([expect.objectContaining({ rule, checker: null, strictness: null })]);
    }),
  );
});
