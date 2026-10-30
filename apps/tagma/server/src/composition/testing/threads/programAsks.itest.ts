import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer, Schema, Stream } from 'effect';
import type { ModelRequestInput } from '@runlith/agent/modelPort';
import type { ThreadCompactionEntry } from '@runlith/agent/transcript/entries';
import type { DecisionRequest } from '@runlith/llm/decision';
import { LLMResponse, Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { QuotaUnsupported } from '@runlith/llm/schema/quota';
import { Settings } from '../../../settings/contract/service/values.js';
import { ThreadDecisions } from '../../../threads/contract/service/decisions.js';
import { THREAD_OPERATIONS } from '../../../threads/contract/wire/operations/catalog.js';
import { knownAnswer } from '../../../platform/contract/wire/operation.js';
import { threadTitleAnswerSchema } from '../../../threads/contract/wire/titles.js';
import { Compaction } from '../../../native-harness/contract/service/context.js';
import { birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { modelDefaults } from '../claudeLogin.js';
import { settledThread } from '../native-harness/settled.fixture.js';
import { ASK_PROGRAM_MODEL, ASK_PROGRAM_PROVIDER } from '../askProgram.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { titleModel } from '../../../threads/contract/wire/settings.js';

const SUMMARY = `## State\n${'The wire member kept the plan and every file it touches. '.repeat(12).trim()}`;

const ready: readonly LLMEvent[] = [
  { type: 'text-start', id: 'text' },
  { type: 'text-delta', id: 'text', text: 'Ready.' },
  { type: 'text-end', id: 'text' },
  { type: 'finish', reason: 'stop', usage: new Usage({ inputTokens: 1_200, outputTokens: 8 }) },
];

const TRIAGE = (state: string): DecisionRequest => ({
  state,
  questions: {
    addressed: { type: 'noul', instructions: 'Does the text ask a person to act?' },
    urgency: { type: 'score', instructions: 'How soon must a person act?', criteria: ['Whenever', 'Today', 'Now'] },
  },
});

const makeFixture = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const summarized: ModelRequestInput[] = [];
  yield* world.lend({
    quotaProviders: [{ id: 'opencode-go', quota: { fromHeaders: () => null, read: () => Effect.fail(new QuotaUnsupported()) } }],
    models: (standing) => ({
      ...standing,
      request: (input) =>
        input.provider === 'subscription'
          ? {
              ...standing.request(input),
              stream: () => Stream.fromIterable(ready),
              text: () => Effect.die('the thread model writes no summary'),
            }
          : {
              plannedOutputTokens: 8_000,
              signedAccount: () => input.account ?? 'unnamed',
              stream: () => Stream.die('a summary never streams'),
              object: () => Effect.die('a summary answers text'),
              text: () =>
                Effect.sync(() => {
                  summarized.push(input);
                  return new LLMResponse({
                    message: Message.assistant(SUMMARY),
                    events: [{ type: 'text-delta', id: 'summary', text: SUMMARY }],
                    usage: new Usage({ inputTokens: 900, outputTokens: 60 }),
                    finishReason: 'stop',
                  });
                }),
            },
    }),
  });
  yield* Effect.acquireRelease(
    world.runtime.tokens.add('subscription', {
      accessToken: 'program-bearer',
      refreshToken: 'program-refresh',
      expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000,
      scope: 'user:inference',
      account: { uuid: crypto.randomUUID(), email: 'program@example.com' },
      organization: { uuid: 'fixture-org', name: 'Fixture' },
    }),
    (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
  );
  yield* Effect.acquireRelease(world.runtime.consoleKeys.save('opencode-go', `program-${crypto.randomUUID()}`), (account) =>
    world.runtime.signIns.removeConsoleKey('opencode-go', account).pipe(Effect.orDie),
  );
  yield* world.runtime.accountQuota.refresh();
  const projectId = yield* world.knowledgeProject();
  yield* projectLeaving(world, projectId);
  yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
  const settings = Context.get(world.runtime.graph, Settings);
  const set = (key: string, value: unknown) => settings.write({ key, value, scope: 'project', projectId });
  const births = birthsOf(world.runtime.owners);
  const turns = turnsOf(world.runtime.owners);
  const talked = Effect.fnUntraced(function* (words: string) {
    const created = yield* Effect.acquireRelease(births.create({ projectId, createdBySessionId: null }), (born) =>
      Effect.orDie(turns.delete(born.thread.id, projectId)),
    );
    const threadId = created.thread.id;
    const opened = yield* turns.send(threadId, projectId, words);
    yield* settledThread({ threadId, projectId, runId: opened.runId }).pipe(Effect.provide(world.runtime.owners));
    return threadId;
  });
  return { world, projectId, set, settings, talked, summarized };
});

class ProgramFixture extends Context.Service<ProgramFixture, Effect.Success<typeof makeFixture>>()('testing/ProgramFixture') {}

layer(Layer.effect(ProgramFixture, makeFixture).pipe(Layer.provide(doorFixture())), { excludeTestServices: true })(
  'asks through a program',
  (it) => {
    it.effect('titles and decisions ask the program model their role names; a setting naming a model that cannot answer refuses', () =>
      Effect.gen(function* () {
        const { world, projectId, set, settings, talked } = yield* ProgramFixture;
        const registry = Context.get(world.runtime.owners as Context.Context<ProviderRegistry>, ProviderRegistry);
        const silent = { provider: 'devin', model: registry.current().models.defaultTextModelId('devin') };
        const refusedWrite = yield* world.op('write_setting', { key: 'threads.titleModel', value: silent }, `project=${projectId}`);
        expect(refusedWrite.body).toMatchObject({ code: 'setting-value' });
        expect(yield* Effect.flip(set('threads.decisionModel', silent))).toMatchObject({ code: 'setting-value' });
        expect(yield* Effect.flip(set('agent.compactionSummarizers', [silent]))).toMatchObject({ code: 'setting-value' });
        expect(
          yield* Effect.flip(
            set('threads.titleModel', { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL, reasoning: 'unoffered' }),
          ),
        ).toMatchObject({ code: 'setting-value' });
        expect(yield* settings.value(titleModel, projectId)).toBeNull();
        yield* set('threads.titleModel', { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL, reasoning: 'high' });
        yield* set('threads.decisionModel', { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL });
        const threadId = yield* talked('Fix the flaky retry in the uploader.');
        const named = yield* world.op('generate_thread_title', { threadId }, `project=${projectId}`);
        expect(yield* Schema.decodeUnknownEffect(threadTitleAnswerSchema)(named.body)).toMatchObject({
          outcome: 'named',
          title: 'Program title',
          source: 'fresh',
        });
        const decisions = Context.get(world.runtime.owners, ThreadDecisions);
        expect(yield* decisions.decide(threadId, TRIAGE('The agent asks which migration to keep.'))).toMatchObject({
          path: 'program',
          model: { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL },
          answers: { addressed: { type: 'noul', noul: true, probability: null }, urgency: { type: 'score', score: 2 } },
        });
        expect(yield* Effect.flip(decisions.decide(threadId, TRIAGE('ASK-MALFORMED')))).toMatchObject({ refusal: 'ask-unreadable-answer' });
        const evidence = yield* world.op(
          'read_thread',
          {
            threadId,
            select: 'activity',
            limit: 10,
            fields: ['kind', 'outcome', 'reason', 'result', 'attrs'],
            where: [{ field: 'kind', op: 'in', value: ['ask'] }],
          },
          `project=${projectId}`,
        );
        const rows = (yield* Schema.decodeUnknownEffect(knownAnswer(THREAD_OPERATIONS.read_thread.answer))(evidence.body)).evidence?.rows;
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attrs: expect.objectContaining({ kind: 'text', path: 'program', provider: ASK_PROGRAM_PROVIDER, rung: 'high' }),
              result: expect.objectContaining({ usage: expect.objectContaining({ outputTokens: expect.any(Number) }) }),
            }),
            expect.objectContaining({
              attrs: expect.objectContaining({ kind: 'decision', path: 'program' }),
              outcome: 'failed',
              reason: 'ask-unreadable-answer',
            }),
          ]),
        );
      }),
    );

    it.effect('compaction summarizes through a program member, and a quota refusal of the program falls through to the wire member', () =>
      Effect.gen(function* () {
        const { world, projectId, set, talked, summarized } = yield* ProgramFixture;
        yield* set('agent.compactionSummarizerRule', 'always');
        yield* set('agent.compactionSummarizers', [
          { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL },
          { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        ]);
        const compacted = Effect.fnUntraced(function* (threadId: string) {
          const compacting = yield* Context.get(world.runtime.owners, Compaction).compact(threadId, projectId, {});
          if (compacting.status !== 'started') return yield* Effect.die(`the compaction answered ${compacting.status}`);
          const after = yield* settledThread({ threadId, projectId, runId: compacting.runId }).pipe(Effect.provide(world.runtime.owners));
          return after.transcript.find(
            (entry) => entry.type === 'compaction' && (entry as ThreadCompactionEntry).runId === compacting.runId,
          ) as ThreadCompactionEntry | undefined;
        });
        expect(yield* compacted(yield* talked('Lay out the plan and the files it touches.'))).toMatchObject({
          status: 'completed',
          summarizer: { provider: ASK_PROGRAM_PROVIDER, model: ASK_PROGRAM_MODEL, own: false, skipped: [] },
        });
        expect(summarized).toHaveLength(0);
        expect(yield* compacted(yield* talked('ASK-QUOTA: lay out the plan.'))).toMatchObject({
          status: 'completed',
          summarizer: {
            provider: 'opencode-go',
            model: 'deepseek-v4.1-flash',
            skipped: [{ provider: ASK_PROGRAM_PROVIDER, reason: 'quota' }],
          },
        });
        expect(summarized.map((request) => request.provider)).toEqual(['opencode-go']);
      }),
    );
  },
);
