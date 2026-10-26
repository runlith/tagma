import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Stream } from 'effect';
import { LLMResponse } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import type { CompactionModels } from '../compaction/CompactionModels';
import type { ThreadCompactionPolicy } from '../compaction/policy';
import { makeThreadSummaryStrategy } from '../compaction/summaryStrategy';
import { makeSummarizerRouter } from './SummarizerRouter';
const policy: ThreadCompactionPolicy = {
  compactionTrigger: { strategy: 'reserve-output' },
  compactionOverrides: [],
  bufferTokens: 1000,
  imageTokens: 0,
  maxRecentTokens: 0,
  minRecentTokens: 0,
  maxOpeningTokens: 0,
  recentFraction: 0,
  recentUserTurns: 0,
  toolPruneProtectShare: 0,
};
it.effect(
  'own and foreign summary requests keep the catalog admitted with their run',
  Effect.fnUntraced(function* () {
    let current = 'first';
    const admitted = new Map([['held-run', current]]);
    const edition = (runId?: string) => (runId === undefined ? current : (admitted.get(runId) ?? current));
    const summary = (held: string) => `${held} anchored state `.repeat(5);
    const models: CompactionModels = {
      defaultModel: (_provider, runId) => edition(runId),
      served: (_provider, model, runId) =>
        Effect.succeed({
          id: model ?? edition(runId),
          capacity: { context: 20_000 },
          cacheLifetime: { promisedSeconds: null, prior: null },
          requestLimits: undefined,
          compactionTrigger: undefined,
        }),
      request: ({ runId }) => ({
        plannedOutputTokens: 1000,
        stream: () => Stream.empty,
        object: () => Effect.die('This summary returns text.'),
        text: () =>
          Effect.succeed(
            new LLMResponse({
              message: Message.assistant(summary(edition(runId))),
              events: [{ type: 'text-delta', id: 'summary', text: summary(edition(runId)) }],
              finishReason: 'stop',
            }),
          ),
      }),
    };
    const strategy = makeThreadSummaryStrategy({ models, prompt: { instructions: 'Summarize', template: 'State' } });
    const router = makeSummarizerRouter({ models, strategy, stallMs: undefined });
    const identity = {
      threadId: 'thread',
      runId: 'held-run',
      ownerId: 'owner',
      provider: 'own-provider',
      model: null,
      reasoning: null,
      switches: {},
    };
    const served = yield* models.served(identity.provider, null, identity.runId);
    const segment = router.segment(identity, served, policy, {
      messages: [Message.user('work'), Message.assistant('done')],
      alreadyCovered: 0,
      coveredMessageCount: 2,
      priorSummary: null,
    });
    current = 'second';
    const own = yield* router.form(identity, 'automatic', undefined, policy, strategy).summarize(segment);
    expect(own.summary.summary).toBe(summary('first').trim());
    const foreign = yield* router
      .form(
        identity,
        'manual',
        {
          kind: 'foreign',
          reason: 'named',
          skipped: [],
          members: [{ provider: 'other-provider', model: 'first', reasoning: null }],
        },
        policy,
        strategy,
      )
      .summarize(segment);
    expect(foreign.summary.summary).toBe(summary('first').trim());
    expect(foreign.summarizer).toMatchObject({ provider: 'other-provider', model: 'first', own: false });
    const next = { ...identity, runId: 'next-run' };
    const nextSegment = router.segment(next, served, policy, {
      messages: segment.messages,
      alreadyCovered: 0,
      coveredMessageCount: 2,
      priorSummary: null,
    });
    const continued = yield* router.form(next, 'automatic', undefined, policy, strategy).summarize(nextSegment);
    expect(continued.summary.summary).toBe(summary('second').trim());
  }),
);
