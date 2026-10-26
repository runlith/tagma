import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer, Queue, Stream } from 'effect';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import type { ThreadCompactionEntry } from '@runlith/agent/transcript/entries';
import { LLMResponse, Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { QuotaObservation, QuotaUnsupported, QuotaWindow } from '@runlith/llm/schema/quota';
import { Settings } from '../../../settings/contract/service/values.js';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import { DoorFixture, doorFixture } from '../doorFixture.js';
import { modelDefaults } from '../claudeLogin.js';
import type { CompactionChoicesRead } from '../../../native-harness/contract/wire/compactionChoices.js';
import { birthsOf, turnsOf, evidenceFeedOf } from '../../../threads/testing/doubles.js';
import { Compaction } from '../../../native-harness/contract/service/context.js';
import { settledThread } from './settled.fixture.js';

const SUMMARY = `## State\n${'The first turn asked for the plan and the answer set it out, with every file it touches. '.repeat(6).trim()}`;

const turn = (text: string): readonly LLMEvent[] => {
  const usage = new Usage({ inputTokens: 1_200, cacheReadInputTokens: 0, outputTokens: 8, totalTokens: 1_208 });
  return [
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', text },
    { type: 'text-end', id: 'text' },
    { type: 'step-finish', index: 0, reason: 'stop', usage },
    { type: 'finish', reason: 'stop', usage },
  ];
};

const makeFixture = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const resets = Math.floor(now / 1_000) + 3_600;
  const sent: { request: ModelRequestInput; call: ModelStreamInput }[] = [];
  const summarized: ModelRequestInput[] = [];
  let firstAccount: string | undefined;
  const world = yield* DoorFixture;
  yield* world.lend({
    quotaProviders: [
      {
        id: 'muse',
        quota: {
          fromHeaders: () => null,
          read: () =>
            Effect.map(
              Clock.currentTimeMillis,
              (observedAt) =>
                new QuotaObservation({
                  observedAt: new Date(observedAt),
                  source: 'usage',
                  windows: [new QuotaWindow({ kind: 'weekly', usedPercent: 100, resetsAt: resets })],
                }),
            ),
        },
      },
      { id: 'opencode-go', quota: { fromHeaders: () => null, read: () => Effect.fail(new QuotaUnsupported()) } },
    ],
    models: (standing) => ({
      ...standing,
      request: (input) =>
        input.provider === 'subscription'
          ? {
              ...standing.request(input),
              signedAccount: () => input.account ?? firstAccount,
              stream: (call) => {
                sent.push({ request: input, call });
                return Stream.fromIterable(turn('Ready.'));
              },
              text: () => Effect.die('The thread’s own model must not be spent for a cold compaction.'),
            }
          : {
              plannedOutputTokens: 8_000,
              signedAccount: () => input.account ?? 'unnamed',
              stream: () => Stream.die('A summary never streams.'),
              object: () => Effect.die('A summary answers text.'),
              text: () =>
                Effect.sync(() => {
                  summarized.push(input);
                  return new LLMResponse({
                    message: Message.assistant(SUMMARY),
                    events: [{ type: 'text-delta', id: 'summary', text: SUMMARY }],
                    usage: new Usage({ inputTokens: 900, outputTokens: 60, totalTokens: 960 }),
                    finishReason: 'stop',
                  });
                }),
            },
    }),
  });
  const anthropic = (uuid: string) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.acquireRelease(
        world.runtime.tokens.add('subscription', {
          accessToken: `bearer-${uuid}`,
          refreshToken: `refresh-${uuid}`,
          expiresAt: now + 3_600_000,
          scope: 'user:inference',
          account: { uuid, email: `${uuid}@example.com` },
          organization: { uuid: 'fixture-org', name: 'Fixture' },
        }),
        (key) => world.runtime.signIns.remove('subscription', key).pipe(Effect.orDie),
      ),
    );
  firstAccount = yield* anthropic(`summarizer-${crypto.randomUUID()}`);
  const projectId = yield* world.knowledgeProject();
  const key = (provider: string) =>
    Effect.acquireRelease(world.runtime.consoleKeys.save(provider, `summarizer-${crypto.randomUUID()}`), (account) =>
      world.runtime.signIns.removeConsoleKey(provider, account).pipe(Effect.orDie),
    );
  return { world, projectId, resets, sent, summarized, anthropic, key };
});

class SummarizerFixture extends Context.Service<SummarizerFixture, Effect.Success<typeof makeFixture>>()('testing/SummarizerFixture') {}

layer(Layer.effect(SummarizerFixture, makeFixture).pipe(Layer.provide(doorFixture())), {
  excludeTestServices: true,
})('compaction summarizer', (it) => {
  it.effect(
    'a cold thread compacts on the first spendable chain member, keeps its selection, and continues on its own model from the checkpoint',
    () =>
      Effect.gen(function* () {
        const { world, projectId, resets, sent, summarized, anthropic, key } = yield* SummarizerFixture;
        const defaults = Context.get(world.runtime.owners, DefaultAccounts);
        yield* Effect.acquireRelease(defaults.defaultAccount('subscription'), (previous) =>
          defaults.saveDefaultAccount('subscription', previous.account).pipe(Effect.orDie),
        );
        const settings = Context.get(world.runtime.graph, Settings);
        const births = birthsOf(world.runtime.owners);
        const turns = turnsOf(world.runtime.owners);
        const feed = evidenceFeedOf(world.runtime.owners);
        const set = (key: string, value: unknown) => settings.write({ key, value, scope: 'project', projectId });
        yield* key('muse');
        yield* key('opencode-go');
        yield* world.runtime.accountQuota.refresh();
        yield* set('agent.compactionSummarizerRule', 'when-cold');
        yield* set('agent.compactionSummarizers', [
          { provider: 'muse', model: 'muse-spark-1.3' },
          { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        ]);
        const choices = Effect.fnUntraced(function* (threadId: string) {
          const read = yield* world.call(`/api/op/read_compaction_choices?project=${projectId}`, { method: 'POST', body: { threadId } });
          expect(read.status).toBe(200);
          return read.body as CompactionChoicesRead;
        });
        yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
        const created = yield* Effect.acquireRelease(births.create({ projectId, createdBySessionId: null }), (born) =>
          Effect.orDie(turns.delete(born.thread.id, projectId)),
        );
        const threadId = created.thread.id;
        const settled = (runId: string) => settledThread({ threadId, projectId, runId }).pipe(Effect.provide(world.runtime.owners));
        const opened = yield* turns.send(threadId, projectId, 'Lay out the plan and the files it touches.');
        const before = (yield* settled(opened.runId)).thread;
        const warm = yield* choices(threadId);
        expect(warm.warmth).toEqual({ state: 'warm', invalidatedBy: null });
        expect(warm.resolved).toMatchObject({ kind: 'own', reason: 'warm', choice: { provider: 'subscription', own: true } });
        expect(warm.chain.map((row) => [row.model, row.spendable, row.skip?.reason ?? null, row.pays.provider])).toEqual([
          ['muse-spark-1.3', false, 'quota', 'muse'],
          ['deepseek-v4.1-flash', true, null, 'opencode-go'],
        ]);
        expect(warm.chain[0]?.skip?.until).toBe(new Date(resets * 1_000).toISOString());
        expect(warm.chain[1]?.estimate).toMatchObject({ passes: 1 });
        const second = yield* anthropic(`summarizer-second-${crypto.randomUUID()}`);
        const republished = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
        yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            feed.subscribe(threadId, (event) => {
              if (event.type === 'state') Queue.offerUnsafe(republished, undefined);
            }),
          ),
          () =>
            Effect.gen(function* () {
              const moved = yield* world.op('set_default_account', { provider: 'subscription', account: second });
              expect(moved.status).toBe(200);
              yield* Queue.take(republished);
            }),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        const cold = yield* choices(threadId);
        expect(cold.warmth).toEqual({ state: 'cold', invalidatedBy: 'account' });
        expect(cold.resolved).toMatchObject({
          kind: 'chain',
          reason: 'cold',
          choice: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
          skipped: [{ provider: 'muse', model: 'muse-spark-1.3', reason: 'quota', until: new Date(resets * 1_000).toISOString() }],
        });
        const compacting = yield* Context.get(world.runtime.owners, Compaction).compact(threadId, projectId, {});
        if (compacting.status !== 'started') return yield* Effect.die(`The compaction answered ${compacting.status}`);
        const after = yield* settled(compacting.runId);
        expect(summarized.map((request) => [request.provider, request.model])).toEqual([['opencode-go', 'deepseek-v4.1-flash']]);
        const entry = after.transcript.find(
          (candidate) => candidate.type === 'compaction' && (candidate as ThreadCompactionEntry).runId === compacting.runId,
        ) as ThreadCompactionEntry | undefined;
        expect(entry).toMatchObject({
          status: 'completed',
          summarizer: {
            provider: 'opencode-go',
            model: 'deepseek-v4.1-flash',
            own: false,
            reason: 'cold',
            skipped: [{ provider: 'muse', reason: 'quota' }],
          },
        });
        expect([after.thread.provider, after.thread.model, after.thread.account, after.thread.reasoning]).toEqual([
          before.provider,
          before.model,
          before.account,
          before.reasoning,
        ]);
        const next = yield* turns.send(threadId, projectId, 'Go on from the plan.');
        yield* settled(next.runId);
        const continued = sent.at(-1)!;
        expect(continued.request.provider).toBe('subscription');
        expect(continued.call.messages.find((message) => message.compaction !== undefined)?.compaction).toMatchObject({
          mode: 'manual',
          preservedCount: expect.any(Number),
        });
      }),
  );
});
