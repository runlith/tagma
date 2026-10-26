import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { ActivityStore } from '@runlith/activity/store';
import { inputItemId } from '@runlith/agent/thread/keyed';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { Context, Deferred, Effect, Layer, Schema, Stream } from 'effect';
import { birthsOf, inboxOf, turnsOf } from '../../../threads/testing/doubles.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { EvidenceFeed } from '../../../threads/contract/service/evidence.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { modelDefaults, subscriptionLogin } from '../claudeLogin.js';

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: () => ({
      plannedOutputTokens: 8,
      text: () => Effect.die(new Error('the activity fixture streams only')),
      object: () => Effect.die(new Error('the activity fixture streams only')),
      stream: () =>
        Stream.fromIterable<LLMEvent>([
          { type: 'text-start', id: 'reply' },
          { type: 'text-delta', id: 'reply', text: 'Done.' },
          { type: 'text-end', id: 'reply' },
          { type: 'finish', reason: 'stop' },
        ]),
    }),
  }),
});
const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const account = yield* subscriptionLogin(world);
  const projectId = yield* world.stealthProject();
  expect(
    yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null }),
  ).toMatchObject({
    provider: 'subscription',
    model: 'claude-sonnet-5-5',
    reasoning: 'low',
    account: null,
  });
  yield* projectLeaving(world, projectId);
  const activities = yield* Effect.provide(ActivityStore, yield* world.runtime.runtime.contextEffect);
  return { world, projectId, account, activities };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/RunActivityWorld') {}
const settledRun = Effect.fn('testing.activityRunSettled')(function* (threadId: string) {
  const { world } = yield* World;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const ended = yield* Deferred.make<string>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          Context.get(world.runtime.owners, EvidenceFeed).subscribe(threadId, (event) => {
            if (event.type === 'state' && event.frame.state.status.life === 'idle' && event.frame.state.latestRun != null)
              Deferred.doneUnsafe(ended, Effect.succeed(event.frame.state.latestRun.id));
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      const state = yield* Context.get(world.runtime.owners, ThreadHarness).reads.snapshot(threadId);
      if (state.activeRun === null && state.latestRun != null) return state.latestRun.id;
      return yield* Deferred.await(ended);
    }),
  );
});
const runRows = Effect.fn('testing.activityRunRows')(function* (threadId: string) {
  const { world, projectId, activities } = yield* World;
  yield* activities.settled;
  const read = yield* world.op(
    'read_thread',
    {
      threadId,
      select: 'activity',
      where: [{ field: 'kind', op: 'eq', value: 'run' }],
      fields: ['at', 'runId', 'kind', 'actor', 'trigger', 'outcome'],
      limit: 2,
    },
    `project=${projectId}`,
  );
  expect(read.status).toBe(200);
  const answer = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread.answer))(read.body);
  if (answer.evidence === undefined) return yield* Effect.die(new Error('the activity read has no evidence'));
  return answer.evidence;
});

layer(Layer.effect(World, setup).pipe(Layer.provide(fixture)), { excludeTestServices: true })('native run provenance', (it) => {
  it.effect('operator words and a child task keep their own run provenance and delivered inbox references', () =>
    Effect.gen(function* () {
      const { world, projectId, account } = yield* World;
      const leadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, account })).thread.id;
      yield* turnsOf(world.runtime.owners).send(leadId, projectId, 'Say done.', undefined, { key: 'say-done' });
      const runId = yield* settledRun(leadId);
      const evidence = yield* runRows(leadId);
      expect(evidence.rows).toHaveLength(1);
      expect(evidence.rows[0]).toMatchObject({
        kind: 'run',
        runId,
        trigger: { kind: 'inbox', refs: [inputItemId({ kind: 'reader' }, 'say-done')] },
      });
      const child = yield* birthsOf(world.runtime.owners).create({
        projectId,
        createdBySessionId: null,
        parent: leadId,
        task: 'Answer this task.',
      });
      const childRun = yield* settledRun(child.thread.id);
      const refs = yield* inboxOf(world.runtime.owners).delivered(child.thread.id, childRun);
      expect(refs).toHaveLength(1);
      const childEvidence = yield* runRows(child.thread.id);
      expect(childEvidence.rows).toHaveLength(1);
      expect(childEvidence.rows[0]).toMatchObject({
        kind: 'run',
        runId: childRun,
        outcome: 'ok',
        actor: { kind: 'thread', id: child.thread.id },
        trigger: { kind: 'inbox', refs },
      });
    }),
  );
});
