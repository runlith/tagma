import { Effect, Scope } from 'effect';
import { Service } from '@runlith/layer/key';
import { Platform } from '@runlith/layer/Platform';
import { Scope as AppScope } from '@runlith/layer/Scope';
import { DetachedSessions } from '@runlith/chat-ui/session/DetachedSessions';
import { PendingTurns } from '@runlith/chat-ui/session/PendingTurns';
import { type ThreadStopOutcome, ThreadStops } from '@runlith/chat-ui/session/ThreadStops.svelte';
import { TurnShaping } from '@runlith/chat-ui/session/TurnShaping';
import { ChatCommandLost, ChatConnection, type ChatThreadView } from '@runlith/chat-ui/wire/ChatConnection';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ChatCommandFailure, ChatCompactAsk } from '@runlith/chat-ui/wire/ChatConnection';
import type { ThreadAttachment, ThreadInteractionAnswer } from '@runlith/agent/transcript/entries';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { Restart } from '$lib/wire/Restart.svelte.js';
import { Offer, type OfferPort } from '$lib/features/notices/Offer.js';
import { DraftShelf } from './native/DraftShelf.svelte.js';
import { PendingStore } from './native/PendingStore.js';
import { attachmentFile } from './native/ThreadUploads.js';
import { Runner } from './Runner.js';
import { ThreadPort } from './ThreadPort.js';

export type ThreadChat = {
  readonly port: ChatConnection<WireThread>;
  readonly pending: PendingTurns;
  readonly stops: ThreadStops;
  readonly shaping: TurnShaping;
  readonly detached: DetachedSessions<WireThread>;
};

const CLOSED = 'The Tagma app closed while this thread call was in flight.';

type Settled<A> = A | { readonly status: 'failed'; readonly message: string };

export class ThreadChats extends Service<ThreadChats>()('ThreadChats', { tier: 'app' }) {
  static *make() {
    const app = yield* AppScope;
    const runner = new Runner();
    app.defer(() => runner.close());
    const platform = yield* Platform;
    return new ThreadChats(
      yield* Live,
      yield* Door,
      runner,
      yield* Restart,
      yield* DraftShelf,
      platform.databases,
      platform.locks,
      yield* Offer.optional(),
    );
  }

  private readonly chats = new Map<number, ThreadChat>();

  constructor(
    private readonly live: LiveConnection,
    private readonly door: Door,
    private readonly runner: Runner,
    private readonly restart: Restart,
    private readonly drafts: DraftShelf,
    private readonly outbox: IDBFactory,
    private readonly locks: LockManager | null,
    private readonly offer?: OfferPort,
  ) {
    super();
  }

  of(projectId: number): ThreadChat {
    const held = this.chats.get(projectId);
    if (held) return held;
    const port = new ThreadPort(this.live, projectId, this.restart, this.offer);
    const fetch = (attachment: ThreadAttachment) => attachmentFile(this.door, projectId, attachment);
    const store = new PendingStore(this.outbox, this.locks, this.drafts, fetch, projectId);
    const made = Effect.gen(function* () {
      const pending = yield* PendingTurns.make(store);
      return { pending, stops: yield* ThreadStops.make(pending) };
    }).pipe(Effect.provideService(ChatConnection<ChatThreadView>(), port), Scope.provide(this.runner.life));
    const chat: ThreadChat = {
      port,
      ...Effect.runSync(made),
      shaping: new TurnShaping(),
      detached: new DetachedSessions<WireThread>(),
    };
    this.chats.set(projectId, chat);
    return chat;
  }

  say(projectId: number, threadId: string, words: { readonly text: string }) {
    return this.settled(this.of(projectId).port.send(threadId, { text: words.text, key: crypto.randomUUID() }));
  }

  answerQuestion(projectId: number, threadId: string, questionId: string, answers: readonly ThreadInteractionAnswer[]) {
    return this.settled(this.of(projectId).port.answer(threadId, { questionId, answers, key: crypto.randomUUID() }));
  }

  continue(projectId: number, threadId: string) {
    return this.settled(this.of(projectId).port.continue(threadId));
  }

  compact(projectId: number, threadId: string, ask: ChatCompactAsk) {
    return this.settled(this.of(projectId).port.compact(threadId, ask));
  }

  stop(projectId: number, threadId: string, runId: string): Promise<ThreadStopOutcome> {
    return this.runner
      .run(this.of(projectId).stops.stop(threadId, runId, null))
      .then((outcome) => outcome ?? { kind: 'failed', failure: new ChatCommandLost({ message: CLOSED }) });
  }

  private async settled<A>(command: Effect.Effect<A, ChatCommandFailure>): Promise<Settled<A>> {
    const done = await this.runner.run(
      Effect.match(command, {
        onFailure: (failure): Settled<A> => ({ status: 'failed', message: failure.message }),
        onSuccess: (done): Settled<A> => done,
      }),
    );
    return done === undefined ? { status: 'failed', message: CLOSED } : done;
  }
}
