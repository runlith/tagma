import { estimateThreadTokens } from '@runlith/agent/thread/compaction/measurement';
import { Message } from '@runlith/llm/schema/messages';
import { Effect } from 'effect';
import { ModelAsks, type Answered, type AskRefused, type AskSelection } from '../../providers/contract/service/asks.js';

export type ExcerptQuestion = {
  readonly system: string;
  readonly instruction: string;
  readonly excerpt: (chars: number) => string;
};

export type ExcerptAsk =
  | { readonly _tag: 'Unfit'; readonly reason: 'input-too-large' | 'no-topic' }
  | { readonly _tag: 'Asking'; readonly text: string; readonly ask: Effect.Effect<Answered<string>, AskRefused> };

export type ExcerptAsks = Effect.Success<ReturnType<typeof makeExcerptAsks>>;

export const makeExcerptAsks = Effect.fnUntraced(function* ({ idleMs }: { readonly idleMs: number }) {
  const asks = yield* ModelAsks;

  const asking = Effect.fnUntraced(function* (selection: AskSelection, question: ExcerptQuestion) {
    const capacity = yield* asks.capacity(selection, question.system);
    const remaining = capacity.input - estimateThreadTokens({ instruction: question.instruction, messages: [Message.user('')] });
    if (remaining <= 0) return { _tag: 'Unfit', reason: 'input-too-large' } satisfies ExcerptAsk;
    const text = question.excerpt(Math.floor(remaining * 4));
    if (text.length === 0) return { _tag: 'Unfit', reason: 'no-topic' } satisfies ExcerptAsk;
    const ask = asks.text(selection, { system: question.system, input: `${text}\n\n${question.instruction}`, stallMs: idleMs });
    return { _tag: 'Asking', text, ask } satisfies ExcerptAsk;
  });

  return { asking };
});
