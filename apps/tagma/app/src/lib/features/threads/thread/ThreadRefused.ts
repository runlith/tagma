import { Data, Effect } from 'effect';
import { type ComposerHandler, ComposerRefused } from '@runlith/chat-ui/composer';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import type { CallFailed } from '$lib/wire/Live.js';

export class ThreadRefused extends Data.TaggedError('ThreadRefused')<{ readonly message: string }> {}

export const refusedBy = (error: unknown): ThreadRefused =>
  new ThreadRefused({ message: error instanceof Error ? error.message : String(error) });

export const refusedCall = (failed: CallFailed): ThreadRefused => new ThreadRefused({ message: failed.refusal.reason });

export const closedCall = (): ThreadRefused => new ThreadRefused({ message: 'The Tagma app closed while this thread call was in flight.' });

export function answered<A>(call: () => Promise<A | undefined>): Effect.Effect<A, ThreadRefused> {
  return Effect.tryPromise({ try: call, catch: refusedBy }).pipe(
    Effect.flatMap((value) => (value === undefined ? Effect.fail(closedCall()) : Effect.succeed(value))),
  );
}

export function asHandler(effect: Effect.Effect<ChatNotice | void, ThreadRefused>): ComposerHandler {
  return Effect.mapError(effect, (refusal) => new ComposerRefused({ message: refusal.message }));
}
