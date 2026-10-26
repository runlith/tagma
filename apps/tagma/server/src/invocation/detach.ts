import { Cause, type Effect, Exit, Option, Schema } from 'effect';
import { referencedThreads, ToolDisplayMeta } from '@runlith/agent/tool/display';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { outcomeLines } from '@runlith/agent/door/outcomeText';
import { refusalBody, type RefusalBody } from '../platform/contract/wire/refusal.js';
import type { CallEnding, DetachedCall, OwedCalls } from '../threads/contract/service/owedCalls.js';
import { answerParts, type Outcome } from './contract/wire/headers.js';

export type DetachedAnswer = { readonly answer: unknown; readonly outcome: Outcome };

const failureWords = (cause: Cause.Cause<RefusalBody>, text: boolean): string => {
  const refused = cause.reasons.find(Cause.isFailReason);
  if (refused === undefined) return Cause.pretty(cause);
  return text ? refusalLines(refused.error).join('\n') : JSON.stringify({ status: 'refused', ...refusalBody(refused.error) }, null, 2);
};

const displayed = Schema.decodeUnknownOption(Schema.Struct({ _meta: ToolDisplayMeta }));

const threadsOf = (answer: unknown) =>
  Option.match(displayed(answer), { onNone: () => [], onSome: (shown) => referencedThreads(shown._meta.toolDisplay.reference) });

const told = (answer: unknown): string => {
  const { document, text } = answerParts(answer);
  return text ?? JSON.stringify(document, null, 2);
};

const cancelled = (reason: string, text: boolean): unknown => {
  const document = { status: 'cancelled', reason };
  return text ? { ...document, _meta: { text: outcomeLines(document).join('\n') } } : document;
};

const endingOf =
  (text: boolean) =>
  (exit: Exit.Exit<DetachedAnswer, RefusalBody>, stopping: boolean): CallEnding =>
    Exit.isSuccess(exit)
      ? {
          outcome: stopping ? 'stopped' : exit.value.outcome === 'negative' ? 'failed' : 'completed',
          result: told(exit.value.answer),
          threads: threadsOf(exit.value.answer),
        }
      : stopping
        ? { outcome: 'stopped', result: failureWords(exit.cause, text) }
        : Cause.hasInterruptsOnly(exit.cause)
          ? { outcome: 'interrupted' }
          : { outcome: 'failed', result: failureWords(exit.cause, text) };

export const detaching =
  (owed: OwedCalls['Service']) =>
  (call: DetachedCall, work: Effect.Effect<DetachedAnswer, RefusalBody>, text: boolean): Effect.Effect<unknown, RefusalBody> =>
    owed.detached(call, work, (reason): DetachedAnswer => ({ answer: cancelled(reason, text), outcome: 'answer' }), endingOf(text));
