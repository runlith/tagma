import { Cause, Effect, Exit, Scope } from 'effect';
import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { Platform } from '@runlith/layer/Platform';
import { Scope as AppScope } from '@runlith/layer/Scope';
import type { ChatEntryHandlers } from '@runlith/chat-ui/entries';
import { DetachedSessions } from '@runlith/chat-ui/session/DetachedSessions';
import { PendingTurns } from '@runlith/chat-ui/session/PendingTurns';
import { ThreadSession } from '@runlith/chat-ui/session/ThreadSession.svelte';
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
import { type ProductRecord, recordOf } from './native/records.js';
import { attachmentFile, attachmentHandlers } from './native/ThreadUploads.js';
import { Runner } from './Runner.js';
import { ThreadPort } from './ThreadPort.js';

export type ThreadChat = {
  readonly port: ChatConnection<WireThread>;
  readonly pending: PendingTurns;
  readonly stops: ThreadStops;
  readonly shaping: TurnShaping;
  readonly detached: DetachedSessions<WireThread>;
};

type ThreadHold = {
  readonly session: ThreadSession<WireThread>;
  older(): Promise<boolean>;
  release(): Promise<void>;
};

export function chatHandlers(door: Door, projectId: number, records: Point<ProductRecord>): ChatEntryHandlers {
  return { ...attachmentHandlers(door, projectId), transcriptEntry: (raw) => recordOf(records, raw) };
}

export function openSession(
  chat: ThreadChat,
  threadId: string,
  handlers: ChatEntryHandlers,
  life: Scope.Closeable,
): ThreadSession<WireThread> {
  const made = ThreadSession.make<WireThread>(threadId, chat.pending, handlers, { detached: chat.detached.take(threadId) }).pipe(
    Effect.provideService(ChatConnection<WireThread>(), chat.port),
  );
  const session = Effect.runSync(Scope.provide(made, life));
  Effect.runSync(session.attach());
  return session;
}

export function closeSession(chat: ThreadChat, threadId: string, session: ThreadSession<WireThread>, life: Scope.Closeable): Promise<void> {
  const detached = Effect.runSync(session.detach());
  if (detached) chat.detached.put(threadId, detached);
  return Effect.runPromise(Scope.close(life, Exit.void));
}

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

  hold(projectId: number, threadId: string, handlers: ChatEntryHandlers): ThreadHold {
    const chat = this.of(projectId);
    const life = Effect.runSync(Scope.fork(this.runner.life));
    const session = openSession(chat, threadId, handlers, life);
    return {
      session,
      older: async () => {
        const exit = await this.runner.settle(session.loadOlder());
        if (Exit.isSuccess(exit)) return exit.value;
        const failure = Cause.squash(exit.cause);
        throw failure instanceof Error ? failure : new Error(String(failure));
      },
      release: () => closeSession(chat, threadId, session, life),
    };
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
