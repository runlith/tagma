import { Effect, Scope as Lifetime } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ChatEntryHandlers } from '@runlith/chat-ui/entries';
import type { ThreadSession } from '@runlith/chat-ui/session/ThreadSession.svelte';
import type { TurnShaping } from '@runlith/chat-ui/session/TurnShaping';
import { Service } from '@runlith/layer/key';
import { Scope } from '@runlith/layer/Scope';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Door } from '$lib/wire/Door.js';
import { ProductRecords } from '../native/records.js';
import { SurfaceChoices, surfaceOf } from '../external/Surface.svelte.js';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { type ThreadChat, ThreadChats, chatHandlers, closeSession, openSession } from '../ThreadChats.js';
import { ThreadEffects } from './ThreadEffects.js';

export class ThreadFeed extends Service<ThreadFeed>()('ThreadFeed', { tier: 'thread' }) {
  static *make() {
    const aim = yield* ProjectRung.Current;
    const thread = yield* ThreadRung.Current;
    const chat = (yield* ThreadChats).of(aim.projectId);
    const handlers = chatHandlers(yield* Door, aim.projectId, yield* ProductRecords);
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
    this.session = openSession(chat, threadId, handlers, life);
    scope.defer(() => closeSession(chat, threadId, this.session, life));
  }
}
