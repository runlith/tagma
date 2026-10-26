import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { ThreadModelChoice } from '@runlith/agent/contracts';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { ModelChange } from '../../../threads/contract/service/modelChanges.js';
import { modelChanges, thread } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

it.live('model changes publish the previous and committed selection, while no-op writes and rollbacks publish nothing', () =>
  Effect.gen(function* () {
    const fixture = yield* threadStoreFixture;
    const changes = yield* Effect.provide(modelChanges(), fixture.context);
    const row = yield* fixture.units.write('modelChanges.birth', (unit) =>
      Effect.gen(function* () {
        const born = yield* fixture.store.insert(
          { ownerId: 'operator', agentId: 'tagma', provider: 'openai-oauth', model: 'before', reasoning: 'high' },
          unit,
        );
        yield* fixture.threads.rows.attachFacet({ threadId: born.id, projectId: fixture.projectId }, unit);
        return born;
      }),
    );
    const heard: ModelChange[] = [];
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        changes.follow((_id, change) =>
          Effect.sync(() => {
            heard.push(change);
          }),
        ),
      ),
      (stop) => Effect.sync(stop),
    );
    const before = { provider: row.provider, model: row.model, reasoning: row.reasoning };
    const selected = { provider: 'subscription', model: 'after', reasoning: 'xhigh' };
    const write = (unit: WriteUnit<'machine'>, choice: ThreadModelChoice) =>
      changes.record(unit, row.id, choice, unit.run(fixture.db.update(thread()).set(choice).where(eq(thread().id, row.id))));
    yield* fixture.units.write('modelChanges.commit', (unit) => write(unit, selected));
    expect(heard).toMatchObject([{ id: expect.any(String), from: before, to: selected }]);
    expect(yield* fixture.threads.list.summary(row.id)).toMatchObject(selected);
    yield* fixture.units.write('modelChanges.noop', (unit) => write(unit, selected));
    const refused = yield* Effect.result(
      fixture.units.write('modelChanges.rollback', (unit) =>
        write(unit, { provider: 'openai-oauth', model: 'rolled-back', reasoning: 'low' }).pipe(Effect.andThen(Effect.fail('rollback'))),
      ),
    );
    expect(refused).toMatchObject({ _tag: 'Failure', failure: 'rollback' });
    expect(heard).toMatchObject([{ from: before, to: selected }]);
    expect(heard).toHaveLength(1);
    expect(yield* fixture.threads.list.summary(row.id)).toMatchObject(selected);
  }),
);
