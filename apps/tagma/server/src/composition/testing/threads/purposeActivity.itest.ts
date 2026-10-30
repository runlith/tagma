import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Layer, Schema, Stream } from 'effect';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { ActivityStore } from '@runlith/activity/store';
import { Settings } from '../../../settings/contract/service/values.js';
import { HarnessAsides } from '../../../threads/contract/service/engine.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { subscriptionLogin, modelDefaults } from '../claudeLogin.js';

const setup = Effect.gen(function* () {
  let account: string | undefined;
  const world = yield* makeDoorWorld({
    models: (standing) => ({
      ...standing,
      request: () => ({
        plannedOutputTokens: 8,
        cache: { ttlSeconds: 3_600 },
        signedAccount: () => account,
        text: () => Effect.die(new Error('the purpose fixture streams only')),
        object: () => Effect.die(new Error('the purpose fixture streams only')),
        stream: () =>
          Stream.fromIterable<LLMEvent>([
            { type: 'text-start', id: 'text' },
            { type: 'text-delta', id: 'text', text: 'Ready.' },
            { type: 'text-end', id: 'text' },
            { type: 'finish', reason: 'stop', usage: new Usage({ inputTokens: 10, outputTokens: 1 }) },
          ]),
      }),
    }),
  });
  account = yield* subscriptionLogin(world);
  const projectId = yield* world.stealthProject();
  yield* projectLeaving(world, projectId);
  return { world, projectId, account };
});

class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/PurposeActivityWorld') {}

layer(Layer.effect(World, setup), { excludeTestServices: true })('purpose activities', (it) => {
  it.effect('a cancelled scheduled recap and a manual recap refused on a moved conversation remain readable activities', () =>
    Effect.gen(function* () {
      const { world, projectId, account } = yield* World;
      const setting = (key: string, value: unknown) =>
        Context.get(world.runtime.graph, Settings).write({ key, value, scope: 'project', projectId });
      yield* setting('threads.autoTitle', false);
      yield* setting('threads.recap', false);
      yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
      const threadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account })).thread.id;
      yield* Effect.addFinalizer(() => turnsOf(world.runtime.owners).delete(threadId, projectId).pipe(Effect.asVoid, Effect.orDie));
      const asides = Context.get(world.runtime.owners, HarnessAsides);
      const send = Effect.fn('testing.purposeSaid')(function* (text: string) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const settled = yield* Deferred.make<void>();
            yield* Effect.acquireRelease(
              Effect.sync(() =>
                asides.watch({
                  opened: () => Effect.void,
                  forgotten: () => Effect.void,
                  settled: (id) => (id === threadId ? Effect.asVoid(Deferred.succeed(settled, undefined)) : Effect.void),
                }),
              ),
              (stop) => Effect.sync(stop),
            );
            yield* turnsOf(world.runtime.owners).send(threadId, projectId, text);
            yield* Deferred.await(settled);
          }),
        );
      });
      yield* send('Explain the plan.');
      yield* send('Confirm the next step.');
      yield* setting('threads.recap', true);
      const capture = asides.of(threadId);
      if (capture === undefined) return yield* Effect.die(new Error('the settled run has no held copy'));
      yield* asides.settled(threadId, capture.runId);
      yield* asides.opened(threadId, 'replacement-run', false);
      expect((yield* world.op('generate_thread_recap', { threadId }, `project=${projectId}`)).body).toMatchObject({
        code: 'not-warm',
      });
      const activities = yield* Effect.provide(ActivityStore, yield* world.runtime.runtime.contextEffect);
      yield* activities.settled;
      const read = yield* world.op(
        'read_thread',
        {
          threadId,
          select: 'activity',
          limit: 2,
          fields: ['at', 'kind', 'actor', 'trigger', 'outcome', 'reason', 'result', 'usage', 'notes'],
          where: [{ field: 'kind', op: 'eq', value: 'recap' }],
        },
        `project=${projectId}`,
      );
      expect(read.status).toBe(200);
      const decoded = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread.answer))(read.body);
      if (decoded.evidence === undefined) return yield* Effect.die(new Error('the purpose read has no activity evidence'));
      const rows = decoded.evidence.rows;
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.outcome === 'cancelled')).toMatchObject({
        actor: { kind: 'server', name: 'recap-schedule' },
        trigger: { kind: 'recap-schedule', refs: [capture.runId, expect.any(String)] },
        result: { effect: 'skipped', reason: 'cancelled' },
      });
      expect(rows.find((row) => row.outcome === 'refused')).toMatchObject({
        actor: { kind: 'operator' },
        trigger: { kind: 'operation', refs: ['generate_thread_recap'] },
        reason: 'not-warm',
        result: { effect: 'skipped', reason: 'not-warm' },
      });
    }),
  );
});
