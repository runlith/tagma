import { Cause, Effect, Queue, Stream } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import {
  type ChatAnswer,
  ChatCommandLost,
  ChatCommandRefused,
  type ChatCompactAsk,
  type ChatConnection,
  ChatFeedBroken,
  type ChatFeedFailure,
  type ChatFeedItem,
  ChatFeedRefused,
  ChatReadRefused,
  type ChatWords,
} from '@runlith/chat-ui/wire/ChatConnection';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import { offeredAct, type OfferPort } from '$lib/features/notices/Offer.js';
import { declared } from './authorityModes.js';
import type { CallFailed, LiveConnection, ServerClient, SubscriptionFailure } from '$lib/wire/Live.js';
import type { Restart } from '$lib/wire/Restart.svelte.js';
import type { LiveError } from '$lib/wire/liveFailure.js';

export class ThreadPort implements ChatConnection<WireThread> {
  constructor(
    private readonly live: LiveConnection,
    private readonly projectId: number,
    private readonly restart: Restart,
    private readonly offer?: OfferPort,
  ) {}

  feed(threadId: string, from: Effect.Effect<FeedPosition | null>): Stream.Stream<ChatFeedItem<WireThread>, ChatFeedFailure> {
    return Stream.callback<ChatFeedItem<WireThread>, ChatFeedFailure>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const unwatch = this.restart.watch();
          const held = this.live.hold(
            (client) =>
              Stream.unwrap(
                Effect.map(from, (since) => client['thread.subscribe']({ projectId: this.projectId, threadId, since: since ?? undefined })),
              ),
            (frame) => {
              Queue.offerUnsafe(queue, withModes(frame));
              this.restart.placeReturned(this.projectId, threadId);
            },
            (failure) => {
              if (failure.kind === 'connection') Queue.offerUnsafe(queue, { type: 'interrupted', message: failure.message });
              else Queue.failCauseUnsafe(queue, Cause.fail(feedFailure(failure)));
            },
            'frame',
          );
          return { unsubscribe: () => (unwatch(), held.unsubscribe()) };
        }),
        (held) => Effect.sync(() => held.unsubscribe()),
      ),
    );
  }

  send(threadId: string, words: ChatWords) {
    return this.act((client) => client['thread.send']({ ...this.at(threadId), params: said(words) }));
  }

  queue(threadId: string, words: ChatWords) {
    return this.act((client) => client['thread.queue']({ ...this.at(threadId), params: said(words) }));
  }

  answer(threadId: string, answer: ChatAnswer) {
    return this.act((client) =>
      client['thread.answer']({
        ...this.at(threadId),
        params: {
          questionId: answer.questionId,
          answers: answer.answers.map((one) => ({
            questionId: one.questionId,
            values: [...one.values],
            annotation: one.annotation,
          })),
          key: answer.key,
        },
      }),
    );
  }

  compact(threadId: string, ask: ChatCompactAsk) {
    return this.act((client) => client['thread.compact']({ ...this.at(threadId), params: ask }));
  }

  continue(threadId: string) {
    return this.act((client) => client['thread.continue'](this.at(threadId)));
  }

  unqueue(threadId: string, inputId: string) {
    return this.act((client) => client['thread.unqueue']({ ...this.at(threadId), params: { inputId } }));
  }

  stop(threadId: string, withdraw: boolean) {
    return Effect.mapError(
      this.live.attemptFirst((client) =>
        client['thread.stop']({ ...this.at(threadId), params: { withdraw: withdraw ? true : undefined } }),
      ),
      (failed) => this.failure(failed),
    );
  }

  entriesBefore(threadId: string, before: number) {
    return Effect.mapError(
      this.live.attempt((client) => client['thread.entries']({ ...this.at(threadId), params: { before } })),
      (failed) => new ChatReadRefused({ message: failed.refusal.reason }),
    );
  }

  entry(threadId: string, entryId: string) {
    return this.live
      .attempt((client) => client['thread.entry']({ ...this.at(threadId), params: { entryId } }))
      .pipe(
        Effect.map((read) => read?.entry ?? null),
        Effect.mapError((failed) => new ChatReadRefused({ message: failed.refusal.reason })),
      );
  }

  private at(threadId: string): { readonly projectId: number; readonly threadId: string } {
    return { projectId: this.projectId, threadId };
  }

  private act<A>(work: (client: ServerClient) => Effect.Effect<A, LiveError>): Effect.Effect<A, ChatCommandRefused | ChatCommandLost> {
    return Effect.mapError(this.live.attempt(work), (failed) => this.failure(failed));
  }

  private failure(failed: CallFailed): ChatCommandRefused | ChatCommandLost {
    const refusal = failed.refusal;
    if (failed.sent && refusal.code === 'transport') return new ChatCommandLost({ message: refusal.reason });
    const told = refusal.told;
    return new ChatCommandRefused({
      message: told.text,
      code: refusal.code,
      told: { note: told.note, details: told.details, code: told.code, act: told.act ?? offeredAct(this.offer, refusal.code) },
    });
  }
}

function feedFailure(failure: SubscriptionFailure): ChatFeedFailure {
  return failure.code === undefined ? new ChatFeedBroken({ message: failure.message }) : new ChatFeedRefused({ message: failure.message });
}

function withModes(item: ChatFeedItem<WireThread>): ChatFeedItem<WireThread> {
  switch (item.type) {
    case 'snapshot':
      return { ...item, payload: { ...item.payload, snapshot: declared(item.payload.snapshot) } };
    case 'resume':
      return { ...item, payload: { ...item.payload, snapshot: declared(item.payload.snapshot) } };
    case 'state':
      return { ...item, payload: { ...item.payload, snapshot: declared(item.payload.snapshot) } };
    default:
      return item;
  }
}

function said(words: ChatWords) {
  return {
    text: words.text || undefined,
    attachments: words.attachments?.length ? [...words.attachments] : undefined,
    key: words.key,
  };
}
