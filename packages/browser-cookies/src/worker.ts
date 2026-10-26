import { eventReason } from '@runlith/utils/worker';
import { Effect } from 'effect';
import { SourceUnreadable, type Unblock } from './source.js';

export type Refusal = { readonly message: string; readonly unblock: Unblock };

type Answer<O> = { readonly value: O } | { readonly refused: Refusal };

declare const self: Worker;

export const serve = <I, O>(work: (input: I) => O, refusal: (cause: unknown) => Refusal): void => {
  self.addEventListener('message', (event: MessageEvent<I>) => {
    let answer: Answer<O>;
    try {
      answer = { value: work(event.data) };
    } catch (cause) {
      answer = { refused: refusal(cause) };
    }
    self.postMessage(answer);
  });
};

export const offLoop = <I, O>(url: URL, input: I, what: string): Effect.Effect<O, SourceUnreadable> =>
  Effect.callback<O, SourceUnreadable>((resume) => {
    let thread: Worker;
    try {
      thread = new Worker(url, { type: 'module' });
    } catch (cause) {
      resume(
        Effect.fail(
          new SourceUnreadable({
            message: `${what} could not be read: its worker did not start: ${String(cause)}`,
            unblock: ['import again'],
          }),
        ),
      );
      return;
    }
    const finish = (outcome: Effect.Effect<O, SourceUnreadable>) => {
      thread.terminate();
      resume(outcome);
    };
    const lost = (reason: string) =>
      finish(Effect.fail(new SourceUnreadable({ message: `${what} could not be read: ${reason}`, unblock: ['import again'] })));
    thread.addEventListener('message', (event: MessageEvent<Answer<O>>) => {
      const answer = event.data;
      finish('value' in answer ? Effect.succeed(answer.value) : Effect.fail(new SourceUnreadable(answer.refused)));
    });
    thread.addEventListener('error', (event: ErrorEvent) => lost(eventReason(event, 'its worker failed')));
    thread.addEventListener('messageerror', () => lost('its answer could not be read back from the worker'));
    thread.postMessage(input);
    return Effect.sync(() => thread.terminate());
  }).pipe(Effect.withSpan('browserCookies.read', { attributes: { what } }));
