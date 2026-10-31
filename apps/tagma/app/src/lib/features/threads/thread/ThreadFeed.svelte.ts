import { Effect, Exit, Scope as Lifetime } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ChatEntryHandlers } from '@runlith/chat-ui/entries';
import { ThreadSession } from '@runlith/chat-ui/session/ThreadSession.svelte';
import type { TurnShaping } from '@runlith/chat-ui/session/TurnShaping';
import { ChatConnection } from '@runlith/chat-ui/wire/ChatConnection';
import { Service } from '@runlith/layer/key';
import { Scope } from '@runlith/layer/Scope';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Door } from '$lib/wire/Door.js';
import { attachmentHandlers } from '../native/ThreadUploads.js';
import { ProductRecords, recordOf } from '../native/records.js';
import { SurfaceChoices, surfaceOf } from '../external/Surface.svelte.js';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { type ThreadChat, ThreadChats } from '../ThreadChats.js';
import { ThreadEffects } from './ThreadEffects.js';

export class ThreadFeed extends Service<ThreadFeed>()('ThreadFeed', { tier: 'thread' }) {
  static *make() {
    const aim = yield* ProjectRung.Current;
    const thread = yield* ThreadRung.Current;
    const chat = (yield* ThreadChats).of(aim.projectId);
    const records = yield* ProductRecords;
    const handlers: ChatEntryHandlers = {
      ...attachmentHandlers(yield* Door, aim.projectId),
      transcriptEntry: (raw) => recordOf(records, raw),
    };
    return new ThreadFeed(thread.id, chat, handlers, yield* ThreadEffects, yield* Scope, yield* SurfaceChoices, aim.projectId);
  }

  readonly session: ThreadSession<WireThread>;
  readonly shaping: TurnShaping;

  get chatThread(): WireThread | null {
    const thread = this.session.thread;
    return thread === null || surfaceOf(thread, this.choices.chatOver(this.projectId, thread.id)) === 'terminal' ? null : thread;
  }

  constructor(
    readonly threadId: string,
    chat: ThreadChat,
    handlers: ChatEntryHandlers,
    effects: ThreadEffects,
    scope: Scope,
    private readonly choices: SurfaceChoices,
    private readonly projectId: number,
  ) {
    super();
    this.shaping = chat.shaping;
    const life = Effect.runSync(Lifetime.fork(effects.life));
    const made = ThreadSession.make<WireThread>(threadId, chat.pending, handlers, { detached: chat.detached.take(threadId) }).pipe(
      Effect.provideService(ChatConnection<WireThread>(), chat.port),
    );
    this.session = Effect.runSync(Lifetime.provide(made, life));
    Effect.runSync(this.session.attach());
    scope.defer(() => {
      const detached = Effect.runSync(this.session.detach());
      if (detached) chat.detached.put(threadId, detached);
      return Effect.runPromise(Lifetime.close(life, Exit.void));
    });
  }
}
