import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { CompactionPlanning } from '../../../threads/contract/service/compaction.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { acpTestKernel } from '../../../external-harnesses/testing/seats.js';

layer(doorFixture(), { excludeTestServices: true })('vendor compaction policy', (it) => {
  it.effect('a vendor-owned session crossing the fill threshold has no Tagma compaction to schedule', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const projectId = yield* world.knowledgeProject();
      const settings = Context.get(world.runtime.graph, Settings);
      yield* settings.write({ scope: 'project', projectId, key: 'agent.compactionTrigger', value: 0.5 });
      const births = birthsOf(world.runtime.owners);
      const turns = turnsOf(world.runtime.owners);
      const created = yield* Effect.acquireRelease(births.create({ projectId, createdBySessionId: null }), (born) =>
        turns.delete(born.thread.id, projectId).pipe(Effect.orDie),
      );
      const planning = Context.get(world.runtime.owners, CompactionPlanning);
      const mode = acpTestKernel('cursor', 'tagma', undefined).capabilities.compaction;
      expect(yield* planning.threshold(created.thread.id, 'cursor', null, 100_000, 'foreign')).toBe(50_000);
      expect(yield* planning.threshold(created.thread.id, 'cursor', null, 100_000, mode)).toBeNull();
    }),
  );
});
