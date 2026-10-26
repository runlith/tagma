import { agentAside, type AgentAsideAnswer } from '@runlith/agent/AgentAside';
import { estimateThreadTokens } from '@runlith/agent/thread/compaction/measurement';
import type { Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import { uuidv7 } from 'uuidv7';
import { Data, Effect } from 'effect';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { ModelAccess } from '../../providers/contract/service/access.js';
import { HarnessAsides } from '../contract/service/engine.js';
import type { HarnessAnswer } from '../contract/service/harness.js';
import type { Road } from '../roads.js';

export type AskingRoad = Extract<Road, { readonly _tag: 'Model' | 'Cli' }>;

export class CliSilent extends Data.TaggedError('CliSilent') {}
export class CliUnsuccessful extends Data.TaggedError('CliUnsuccessful')<{ readonly answer: HarnessAnswer }> {}

export type ExcerptQuestion = {
  readonly system: string;
  readonly instruction: string;
  readonly excerpt: (chars: number) => string;
};

export type ExcerptAsk =
  | { readonly _tag: 'Unfit'; readonly reason: 'invalid-selection' | 'input-too-large' | 'no-topic' }
  | {
      readonly _tag: 'Asking';
      readonly text: string;
      readonly ask: Effect.Effect<AgentAsideAnswer, unknown>;
      readonly usage: () => Usage | undefined;
    };

export type ExcerptAsks = Effect.Success<ReturnType<typeof makeExcerptAsks>>;

export const makeExcerptAsks = Effect.fnUntraced(function* ({ idleMs }: { readonly idleMs: number }) {
  const models = yield* ModelAccess;
  const asides = yield* HarnessAsides;

  const asking = Effect.fnUntraced(function* (threadId: string, road: AskingRoad, question: ExcerptQuestion) {
    let spent: Usage | undefined;
    const usage = () => spent;
    if (road._tag === 'Cli') {
      const capacity = road.cli.capacity;
      const remaining =
        Math.min(capacity.input ?? capacity.context, capacity.context - (capacity.output ?? 0)) -
        estimateThreadTokens({ system: question.system, instruction: question.instruction, messages: [Message.user('')] });
      if (remaining <= 0) return { _tag: 'Unfit', reason: 'input-too-large' } satisfies ExcerptAsk;
      const text = question.excerpt(Math.floor(remaining * 4));
      if (text.length === 0) return { _tag: 'Unfit', reason: 'no-topic' } satisfies ExcerptAsk;
      const ask = road.cli.ask(threadId, { system: question.system, text: `${text}\n\n${question.instruction}` }).pipe(
        Effect.tap((said) =>
          Effect.sync(() => {
            spent = said?.usage;
          }),
        ),
        Effect.flatMap((said): Effect.Effect<AgentAsideAnswer, CliSilent | CliUnsuccessful> =>
          said === null
            ? Effect.fail(new CliSilent())
            : said.outcome === 'failed'
              ? Effect.fail(new CliUnsuccessful({ answer: said }))
              : Effect.succeed<AgentAsideAnswer>({ text: said.text, finishReason: 'stop', usage: said.usage }),
        ),
      );
      return { _tag: 'Asking', text, ask, usage } satisfies ExcerptAsk;
    }
    const { option, reasoning, account } = road;
    const request = models.request({
      ownerId: OPERATOR_PRINCIPAL,
      provider: option.provider,
      model: option.id,
      reasoning,
      account: account ?? undefined,
      instructions: question.system,
      cache: 'none',
      reasoningOutput: false,
    });
    if (request.refusal) return { _tag: 'Unfit', reason: 'invalid-selection' } satisfies ExcerptAsk;
    const capacity = yield* models.served(option.provider, option.id).pipe(
      Effect.map((served) => served.capacity),
      Effect.catchTag('ThreadModelNotServed', () => Effect.succeed(undefined)),
    );
    if (capacity === undefined) return { _tag: 'Unfit', reason: 'invalid-selection' } satisfies ExcerptAsk;
    const remaining =
      capacity.context -
      request.plannedOutputTokens -
      estimateThreadTokens({
        system: request.system,
        providerOptions: request.providerOptions,
        instruction: question.instruction,
        messages: [Message.user('')],
      });
    if (remaining <= 0) return { _tag: 'Unfit', reason: 'input-too-large' } satisfies ExcerptAsk;
    const text = question.excerpt(Math.floor(remaining * 4));
    if (text.length === 0) return { _tag: 'Unfit', reason: 'no-topic' } satisfies ExcerptAsk;
    const prompt = agentAside({ runId: uuidv7(), stepNumber: 0, request, messages: [Message.user(text)], tools: {}, stallMs: idleMs });
    return { _tag: 'Asking', text, ask: asides.ask(threadId, prompt, { instruction: question.instruction }), usage } satisfies ExcerptAsk;
  });

  return { asking };
});
