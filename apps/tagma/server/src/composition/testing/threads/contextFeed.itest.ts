import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Usage } from '@runlith/llm/schema/events';
import { threadEntryEvent } from '@runlith/agent/thread/events';
import type { ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import { Clock, Context, Deferred, Effect, Stream } from 'effect';
import { Settings } from '../../../settings/contract/service/values.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { writes } from '../../../platform/contract/service/writes.js';
import { NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { modelDefaults, subscriptionLogin } from '../claudeLogin.js';
import { windowChannel } from './windowChannel.js';

const fixture = doorFixture();

it.live('a running thread sends its committed context measurement through the window subscription', () =>
  Effect.gen(function* () {
    const world = yield* DoorFixture;
    const streaming = yield* Deferred.make<void>();
    yield* world.lend({
      models: (standing) => ({
        ...standing,
        request: (input) => ({
          ...standing.request(input),
          stream: () => Stream.unwrap(Effect.as(Deferred.succeed(streaming, undefined), Stream.never)),
        }),
      }),
    });
    const account = yield* subscriptionLogin(world);
    const projectId = yield* world.knowledgeProject();
    yield* projectLeaving(world, projectId);
    yield* Context.get(world.runtime.graph, Settings).write({ key: 'threads.autoTitle', value: false, scope: 'project', projectId });
    yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
    const owners = world.runtime.owners;
    const turns = turnsOf(owners);
    const { thread } = yield* Effect.acquireRelease(
      birthsOf(owners).create({ projectId, createdBySessionId: null, account }),
      ({ thread }) => turns.delete(thread.id, projectId).pipe(Effect.asVoid, Effect.orDie),
    );
    const window = yield* windowChannel(world);
    const next = yield* Stream.toPull(window['thread.subscribe']({ projectId, threadId: thread.id }));
    expect((yield* next)[0]).toMatchObject({ type: 'snapshot' });
    const { runId } = yield* turns.send(thread.id, projectId, 'Measure this request.');
    yield* Deferred.await(streaming);
    const harness = Context.get(owners, ThreadHarness);
    yield* harness.threads.publish(thread.id);
    const usage = new Usage({ inputTokens: 1_200, outputTokens: 40, reasoningTokens: 10, totalTokens: 1_240 });
    const measuredAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const reports = harness.runs.reports().of(thread.transport.adapter);
    const plan = reports.recorded(
      { id: runId, threadId: thread.id },
      [threadEntryEvent({ type: 'message', id: 'measured-answer', role: 'assistant', runId, text: 'Measured.' })],
      'context-feed',
      {
        reading: {
          kind: 'measured',
          reading: {
            usage,
            contextWindow: 200_000,
            runId,
            stepNumber: 0,
            provider: thread.provider,
            model: thread.model,
            measuredAt,
            stale: false,
          },
        },
      },
    );
    const storage = Context.get(owners, NativeStorage);
    yield* reports.cut(
      thread.id,
      Context.get(world.runtime.graph, MachineUnits).write(writes('testing.contextFeed', [], storage.writes), (unit) =>
        Effect.gen(function* () {
          yield* harness.threads.stepping(thread.id, unit);
          yield* plan.run(unit as unknown as ThreadWriteTx);
          yield* harness.threads.stepped(thread.id, unit);
        }),
      ),
    );
    for (;;) {
      const frames = yield* next;
      const measured = frames.find(
        (frame) => frame.type === 'state' && frame.payload.snapshot.thread.contextReading?.usage.totalTokens === 1_240,
      );
      if (measured?.type !== 'state') continue;
      expect(measured.payload.snapshot.activeRun?.id).toBe(runId);
      expect(measured.payload.snapshot.thread.contextReading).toMatchObject({ runId, stepNumber: 0, stale: false, usage });
      expect(measured.payload.snapshot.thread.contextReading?.usage.visibleOutputTokens).toBe(30);
      break;
    }
  }).pipe(Effect.provide(fixture)),
);
