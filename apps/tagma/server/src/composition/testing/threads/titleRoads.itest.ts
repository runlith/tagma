import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Stream } from 'effect';
import { LLMResponse, type LLMEvent } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { Settings } from '../../../settings/contract/service/values.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { HarnessReports } from '../../../external-harnesses/contract/service/reports.js';
import { birthsOf, inboxOf, listOf, titlesOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { subscriptionLogin } from '../claudeLogin.js';

const fixture = doorFixture({
  models: (standing) => ({
    ...standing,
    request: () => ({
      plannedOutputTokens: 32,
      text: () =>
        Effect.succeed(
          new LLMResponse({
            message: Message.assistant('TITLE: Model title'),
            events: [{ type: 'text-delta', id: 'text', text: 'TITLE: Model title' }],
            finishReason: 'stop',
          }),
        ),
      object: () => Effect.die(new Error('the title fixture answers text')),
      stream: () =>
        Stream.fromIterable<LLMEvent>([
          { type: 'text-start', id: 'text' },
          { type: 'text-delta', id: 'text', text: 'TITLE: Model title' },
          { type: 'text-end', id: 'text' },
          { type: 'finish', reason: 'stop' },
        ]),
    }),
  }),
});

const external = Effect.fnUntraced(function* (projectId: number, harness: string) {
  const world = yield* DoorFixture;
  const threadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null, type: `harness:${harness}` }))
    .thread.id;
  yield* inboxOf(world.runtime.owners).put({
    id: `reader:${crypto.randomUUID()}`,
    threadId,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text: 'Fix the flaky retry in the uploader', attachments: [] },
    occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  });
  return threadId;
});

layer(fixture, { excludeTestServices: true })('external thread naming', (it) => {
  it.effect('a CLI with no ask path refuses, while a connected provider names a thread from its reader words during the turn', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const projectId = yield* world.plainProject();
      yield* projectLeaving(world, projectId);
      yield* Context.get(world.runtime.graph, Settings).write({ key: 'threads.harnessTitle', value: false, scope: 'project', projectId });
      const silent = yield* external(projectId, 'devin');
      expect(yield* Effect.flip(titlesOf(world.runtime.owners).generate(silent, projectId))).toMatchObject({ code: 'ask-unanswerable' });
      yield* subscriptionLogin(world);
      const threadId = yield* external(projectId, 'claude-code');
      const named = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          listOf(world.runtime.owners).subscribe(projectId, (event) => {
            if (event.kind === 'row' && event.row.id === threadId && event.row.titleOrigin === 'generated')
              Deferred.doneUnsafe(named, Effect.void);
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      yield* Context.get(world.runtime.owners, HarnessReports).reported(threadId, {
        event: { hook_event_name: 'UserPromptSubmit', session_id: 'title-session' },
        prompt: 'Fix the flaky retry in the uploader',
        capturedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      });
      yield* Deferred.await(named);
      expect(yield* Context.get(world.runtime.owners, ThreadRecords).facts(threadId)).toMatchObject({
        title: 'Model title',
        titleProvenance: 'generated',
      });
    }),
  );
});
