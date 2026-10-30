import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Fiber, Schema, Stream } from 'effect';
import { LLMResponse, Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { activity, CurrentActivity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityStore } from '@runlith/activity/store';
import { triggered } from '../../../invocation/testing/performing.js';
import { ThreadRecapWriting } from '../../../threads/contract/service/recapWriting.js';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { Settings } from '../../../settings/contract/service/values.js';
import { HarnessAsides } from '../../../threads/contract/service/asides.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { modelDefaults } from '../claudeLogin.js';
import { birthsOf, turnsOf, titlesOf } from '../../../threads/testing/doubles.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { threadTitleAnswerSchema } from '../../../threads/contract/wire/titles.js';
import { credentialMissing } from '../../../providers/credentials/missing.js';

type Sent = { readonly request: ModelRequestInput; readonly call: ModelStreamInput; readonly within: string | undefined };
const fixture = doorFixture();

it.live(
  'held-prefix naming preserves its road, authorship and cancellation, while rejected answers and changed accounts use fresh naming',
  () =>
    Effect.gen(function* () {
      const opened = yield* Deferred.make<void>();
      const interruption = yield* Deferred.make<void>();
      const sent: Sent[] = [];
      const excerpted: ModelRequestInput[] = [];
      let account: string | undefined;
      let answer = 'NO-TOPIC';
      let first = true;
      let broken = false;
      let suspended = false;
      let recapping = false;
      const world = yield* DoorFixture;
      yield* world.lend({
        models: (standing) => ({
          ...standing,
          request: (input) => ({
            plannedOutputTokens: 32,
            origin:
              input.model == null
                ? undefined
                : new ModelIdentity({ provider: ProviderID.make(input.provider), model: ModelID.make(input.model) }),
            cache: { ttlSeconds: 3_600 },
            signedAccount: () => account,
            text: () =>
              Effect.sync(() => {
                excerpted.push(input);
                return new LLMResponse({
                  message: Message.assistant('TITLE: Compact result'),
                  events: [{ type: 'text-delta', id: 'text', text: 'TITLE: Compact result' }],
                  usage: new Usage({ inputTokens: 20, outputTokens: 4 }),
                  finishReason: 'stop',
                });
              }),
            object: () => Effect.die(new Error('the naming fixture answers no objects')),
            stream: (call) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  const current = yield* CurrentActivity;
                  sent.push({ request: input, call, within: current?.id });
                  const naming = !first;
                  first = false;
                  if (naming && !recapping && Object.keys(call.tools).length > 0) yield* Deferred.succeed(opened, undefined);
                  if (naming && suspended) {
                    yield* Deferred.succeed(interruption, undefined);
                    return Stream.fromEffect(Effect.never);
                  }
                  if (naming && broken) return Stream.fail(credentialMissing('fixture transport failure'));
                  if (naming && Object.keys(call.tools).length > 0 && answer === 'tool')
                    return Stream.fromIterable<LLMEvent>([
                      { type: 'tool-call', id: 'call', name: 'read', input: {} },
                      { type: 'finish', reason: 'tool-calls' },
                    ]);
                  const text = recapping ? 'SUMMARY: Prefix reuse was explained and verified.\nNEXT: none' : !naming ? 'Ready.' : answer;
                  return Stream.fromIterable<LLMEvent>([
                    { type: 'text-start', id: 'text' },
                    { type: 'text-delta', id: 'text', text },
                    { type: 'text-end', id: 'text' },
                    { type: 'finish', reason: 'stop', usage: new Usage({ inputTokens: 20, outputTokens: 4 }) },
                  ]);
                }),
              ),
          }),
        }),
      });
      const projectId = yield* world.stealthProject();
      const settings = Context.get(world.runtime.graph, Settings);
      const naming = titlesOf(world.runtime.owners);
      const turns = turnsOf(world.runtime.owners);
      account = yield* Effect.acquireRelease(
        world.runtime.tokens.add('subscription', {
          accessToken: 'fixture-bearer',
          refreshToken: 'fixture-refresh',
          expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
          scope: 'user:inference',
          account: { uuid: crypto.randomUUID(), email: 'fixture@example.com' },
          organization: { uuid: 'fixture-org', name: 'Fixture' },
        }),
        (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
      );
      for (const [key, value] of Object.entries({
        'threads.autoTitle': true,
        'threads.titleCharacters': 128,
        'threads.titleModel': { provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'low' },
      }))
        yield* settings.write({ key, value, scope: 'project', projectId });
      yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
      yield* projectLeaving(world, projectId);
      const threadId = (yield* birthsOf(world.runtime.owners).create({ projectId, createdBySessionId: null })).thread.id;
      yield* Effect.addFinalizer(() => turns.delete(threadId, projectId).pipe(Effect.asVoid, Effect.orDie));
      const settled = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          Context.get(world.runtime.owners, HarnessAsides).watch({
            opened: () => Effect.void,
            forgotten: () => Effect.void,
            settled: (id) => (id === threadId ? Effect.asVoid(Deferred.succeed(settled, undefined)) : Effect.void),
          }),
        ),
        (stop) => Effect.sync(stop),
      );
      yield* turns.send(threadId, projectId, 'Explain prefix reuse. ' + 'Reader detail. '.repeat(100));
      yield* Deferred.await(opened);
      yield* Deferred.await(settled);
      answer = 'TITLE: Cached result';
      const generated = yield* world.op('generate_thread_title', { threadId }, `project=${projectId}`);
      expect(generated.status).toBe(200);
      expect(yield* Schema.decodeUnknownEffect(threadTitleAnswerSchema)(generated.body)).toMatchObject({
        outcome: 'named',
        title: 'Cached result',
        source: 'captured',
      });
      const primary = sent[0]!;
      const captured = sent.at(-1)!;
      expect(captured.request).toBe(primary.request);
      expect(captured.call.tools).toBe(primary.call.tools);
      expect(captured.call.messages.slice(0, -2)).toEqual([...primary.call.messages]);
      expect(captured.call.messages.at(-2)).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Ready.' }] });
      const caller = {
        actor: { kind: 'thread' as const, threadId, projectId, principalId: 'operator', session: { harness: 'tagma', key: threadId } },
        files: null,
      };
      const withinActivity = <A, E>(operation: string, work: Effect.Effect<A, E>) =>
        activity(activityKind('fixture'), {}, triggered(operation, caller, work).pipe(Effect.provide(world.runtime.door)), {
          thread: threadId,
          actor: { kind: 'server', name: 'fixture' },
        });
      expect(yield* withinActivity('generate_thread_title', naming.generate(threadId, projectId))).toMatchObject({
        outcome: 'named',
        title: 'Cached result',
      });
      suspended = true;
      const interrupted = yield* Effect.forkScoped(naming.generate(threadId, projectId));
      yield* Deferred.await(interruption);
      yield* Fiber.interrupt(interrupted);
      suspended = false;
      recapping = true;
      expect(
        yield* withinActivity('generate_thread_recap', Context.get(world.runtime.owners, ThreadRecapWriting).generate(threadId, projectId)),
      ).toMatchObject({ summary: 'Prefix reuse was explained and verified.' });
      recapping = false;
      answer = 'TITLE: One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
      expect(yield* naming.generate(threadId, projectId)).toMatchObject({
        outcome: 'named',
        title: 'Compact result',
        source: 'fresh',
        freshReason: 'captured-rejected',
      });
      expect(excerpted.at(-1)).toMatchObject({ provider: 'openai-oauth', model: 'gpt-5.5', reasoning: 'low', cache: 'none' });
      const activities = yield* Effect.provide(ActivityStore, yield* world.runtime.runtime.contextEffect);
      yield* activities.settled;
      const evidence = yield* world.op(
        'read_thread',
        {
          threadId,
          select: 'activity',
          limit: 12,
          fields: ['at', 'kind', 'actor', 'trigger', 'runId', 'parent', 'outcome', 'reason', 'result', 'notes', 'attrs'],
          where: [{ field: 'kind', op: 'in', value: ['title', 'recap'] }],
        },
        `project=${projectId}`,
      );
      expect(evidence.status).toBe(200);
      const decoded = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread.answer))(evidence.body);
      const rows = decoded.evidence?.rows;
      if (rows === undefined) return yield* Effect.die(new Error('the naming read has no activity rows'));
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor: { kind: 'operator' },
            trigger: { kind: 'operation', refs: ['generate_thread_title'] },
            outcome: 'ok',
            result: expect.objectContaining({
              effect: expect.objectContaining({ after: expect.objectContaining({ title: 'Cached result' }), outcome: 'written' }),
            }),
            notes: expect.arrayContaining([
              expect.objectContaining({ type: 'model-chosen', road: 'warm', provider: 'subscription', account }),
            ]),
          }),
          expect.objectContaining({
            actor: { kind: 'thread', id: threadId },
            trigger: { kind: 'operation', refs: ['generate_thread_title'] },
            result: expect.objectContaining({
              effect: expect.objectContaining({
                before: expect.objectContaining({ title: 'Cached result' }),
                after: expect.objectContaining({ title: 'Cached result' }),
                outcome: 'same-text',
              }),
            }),
          }),
          expect.objectContaining({ kind: 'title', outcome: 'cancelled' }),
          expect.objectContaining({
            kind: 'title',
            outcome: 'failed',
            reason: 'too-long',
            attrs: expect.objectContaining({ source: 'captured' }),
          }),
          expect.objectContaining({
            kind: 'title',
            notes: expect.arrayContaining([
              expect.objectContaining({
                type: 'model-chosen',
                road: 'fresh',
                freshReason: 'captured-rejected',
                provider: 'openai-oauth',
                model: 'gpt-5.5',
              }),
            ]),
          }),
          expect.objectContaining({
            actor: { kind: 'server', name: 'title-hook' },
            trigger: expect.objectContaining({ kind: 'title-hook' }),
          }),
          expect.objectContaining({
            kind: 'recap',
            actor: { kind: 'thread', id: threadId },
            trigger: { kind: 'operation', refs: ['generate_thread_recap'] },
            outcome: 'ok',
            result: { effect: 'published' },
            notes: expect.arrayContaining([expect.objectContaining({ type: 'model-chosen', road: 'warm', account })]),
          }),
        ]),
      );
      const rejected = rows.find((row) => row.kind === 'title' && row.reason === 'too-long');
      expect(rejected?.parent).toEqual(expect.any(String));
      expect(sent.some((asked) => `activity:${asked.within}` === rejected?.at)).toBe(true);
      const expanded = yield* world.op('read_thread_record', { at: [{ threadId, at: rejected?.at }] }, `project=${projectId}`);
      expect(expanded.status).toBe(200);
      const retained = yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread_record.answer))(expanded.body);
      expect(retained).toMatchObject({
        expanded: [
          {
            fact: {
              bodies: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'response',
                  value: expect.objectContaining({ text: answer, finishReason: 'stop', reason: 'too-long', source: 'captured' }),
                }),
              ]),
            },
          },
        ],
      });
      const recap = rows.find((row) => row.kind === 'recap');
      const cancelled = rows.find((row) => row.outcome === 'cancelled');
      expect(recap?.parent).toEqual(cancelled?.parent);
      answer = 'tool';
      expect(yield* naming.generate(threadId, projectId)).toMatchObject({
        outcome: 'named',
        source: 'fresh',
        freshReason: 'captured-rejected',
      });
      answer = 'NO-TOPIC';
      expect(yield* naming.generate(threadId, projectId)).toMatchObject({ outcome: 'no-topic', source: 'captured' });
      broken = true;
      const failed = yield* naming.generate(threadId, projectId);
      expect(failed).toMatchObject({ outcome: 'failed', reason: 'model-failed', source: 'captured' });
      expect(sent.at(-1)!.request).toBe(primary.request);
      expect(failed.attemptId).toStartWith('title:');
      broken = false;
      const second = yield* Effect.acquireRelease(
        world.runtime.tokens.add('subscription', {
          accessToken: 'second-bearer',
          refreshToken: 'second-refresh',
          expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
          scope: 'user:inference',
          account: { uuid: crypto.randomUUID(), email: 'second@example.com' },
          organization: { uuid: 'fixture-org', name: 'Fixture' },
        }),
        (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
      );
      yield* Context.get(world.runtime.owners, DefaultAccounts).saveDefaultAccount('subscription', second);
      expect(yield* naming.generate(threadId, projectId)).toMatchObject({
        outcome: 'named',
        source: 'fresh',
        freshReason: 'account-changed',
      });
    }).pipe(Effect.provide(fixture)),
);
