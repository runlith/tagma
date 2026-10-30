import { Effect } from 'effect';
import type { Usage } from '@runlith/acp/methods';
import { failed } from './calls.js';
import type { Channel } from './channel.js';
import { spent } from './translate.js';

export type AsideAnswered = {
  readonly text: string;
  readonly usage?: Usage;
  readonly _meta?: Readonly<Record<string, unknown>>;
};

export const aside = Effect.fnUntraced(function* (channel: Channel, question: string) {
  const ask = yield* channel.sideQuestions();
  const before = yield* channel.reading();
  const answer = yield* ask(question);
  const after = yield* channel.reading();
  if (answer === null || answer.response === null)
    return yield* failed('Claude Code holds no conversation to answer the side question from');
  if (answer.synthetic) return yield* failed(answer.response);
  if (before === null || after === null) return { text: answer.response } as AsideAnswered;
  const { usage, cost } = spent(before, after);
  const answered: AsideAnswered = { text: answer.response, usage, _meta: { 'tagma/cost': cost } };
  return answered;
});
