import { expect } from 'bun:test';
import { Clock, Context, Effect } from 'effect';
import { layer } from '@runlith/effect-test';
import { ModelPreferences } from './contract/service/models.js';
import { makeModelPreferenceRows } from './models/preferences.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { birthsOf } from '../threads/testing/doubles.js';
import { bornThread } from './testing/born.js';
import { thread } from '../threads/store/kernel.js';
import { eq, sql } from 'drizzle-orm';
import { DoorFixture, doorFixture } from '../composition/testing/doorFixture.js';
import { SUBSCRIPTION_PROVIDER } from '@runlith/builtin-catalog/subscription/description';
import { modelPreference } from './store/preferences.js';

layer(doorFixture(), { excludeTestServices: true })('model defaults', (it) => {
  it.effect('a saved model no installed adapter serves gives way to the served default and keeps its stored ids', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const defaults = Context.get(world.runtime.owners, ModelPreferences);
      const births = birthsOf(world.runtime.owners);
      const projectId = yield* world.stealthProject();
      const rows = yield* Effect.provide(makeModelPreferenceRows, world.runtime.graph);
      const { db } = Context.get(world.runtime.graph, MachineStore);
      const where = eq(modelPreference.principalId, OPERATOR_PRINCIPAL);
      yield* Effect.acquireRelease(db.select().from(modelPreference).where(where).get(), (previous) =>
        Effect.gen(function* () {
          yield* db.delete(modelPreference).where(where);
          if (previous !== undefined) yield* db.insert(modelPreference).values(previous);
        }).pipe(Effect.orDie),
      );
      yield* Effect.acquireRelease(
        world.runtime.tokens.add(SUBSCRIPTION_PROVIDER, {
          accessToken: 'held-bearer',
          refreshToken: 'held-refresh',
          expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
          scope: 'user:inference',
          account: { uuid: 'held-account', email: 'held@example.com' },
          organization: { uuid: 'held-org', name: 'Held' },
        }),
        (key) => world.runtime.signIns.remove(SUBSCRIPTION_PROVIDER, key).pipe(Effect.orDie),
      );
      yield* db.delete(modelPreference).where(where);
      yield* rows.saveFavoriteModels(OPERATOR_PRINCIPAL, { models: [] });
      expect(yield* rows.modelSelection(OPERATOR_PRINCIPAL)).toBeNull();
      const answer = yield* defaults.modelDefaults();
      if (answer.status !== 'read') return yield* Effect.die('a provider holding an account answers a default model');
      const fresh = answer.defaults;
      const remembered = { reasoningDisplay: 'omitted' };
      yield* rows.saveModelSelection(OPERATOR_PRINCIPAL, {
        provider: fresh.provider,
        model: fresh.model,
        reasoning: fresh.reasoning,
        switches: remembered,
      });
      const gone = { provider: 'removed-provider', model: 'held-model', reasoning: null, switches: {} };
      yield* rows.saveModelSelection(OPERATOR_PRINCIPAL, gone);
      const served = { ...fresh, switches: remembered };
      expect(yield* defaults.modelDefaults()).toEqual({
        status: 'read',
        defaults: served,
        remembered: { [fresh.provider]: { [fresh.model]: remembered } },
      });
      expect(yield* world.op('read_model_defaults', {})).toMatchObject({
        status: 200,
        body: { provider: served.provider, model: served.model, switches: remembered },
      });
      const born = yield* births.create({ projectId, createdBySessionId: null });
      expect(born.thread).toMatchObject({ provider: served.provider, model: served.model, switches: remembered });
      expect(yield* rows.modelSelection(OPERATOR_PRINCIPAL)).toEqual(gone);

      const kept = { provider: served.provider, model: served.model };
      yield* rows.saveFavoriteModels(OPERATOR_PRINCIPAL, { models: [{ provider: gone.provider, model: gone.model }, kept] });
      const favorites = yield* defaults.favoriteModels();
      expect(favorites.models).toEqual([kept]);
      expect(yield* defaults.setFavoriteModels(favorites)).toEqual({ models: [kept] });

      yield* db.update(thread).set({ provider: gone.provider, model: gone.model }).where(eq(thread.id, born.thread.id));
      const moved = yield* world.op(
        'set_thread_model',
        { threadId: born.thread.id, provider: served.provider, model: served.model, reasoning: served.reasoning, switches: {} },
        `project=${projectId}`,
      );
      expect(moved).toMatchObject({ status: 200 });
      expect(
        yield* db.select({ provider: thread.provider, model: thread.model }).from(thread).where(eq(thread.id, born.thread.id)).get(),
      ).toEqual(kept);
    }),
  );

  it.effect('removing provider schema defaults preserves native thread revision propagation', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const { db } = Context.get(world.runtime.graph, MachineStore);
      yield* bornThread(db, {
        id: 'revision-thread',
        ownerId: OPERATOR_PRINCIPAL,
        agentId: 'agent',
        spawnRootId: 'revision-thread',
        provider: 'test-provider',
        authority: { mode: 'trust', bypassFrom: null },
      });
      yield* db.update(thread).set({ provider: 'next-provider' }).where(eq(thread.id, 'revision-thread'));
      expect(yield* db.all(sql`select fold_rev, inherit_rev from native_thread_rev where thread_id = 'revision-thread'`)).toEqual([
        { fold_rev: 1, inherit_rev: 1 },
      ]);
    }),
  );
});
