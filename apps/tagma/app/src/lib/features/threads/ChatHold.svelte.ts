import { Cause, Effect, Exit, Scope } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ChatEntryHandlers } from '@runlith/chat-ui/entries';
import type { PromptHistory } from '@runlith/chat-ui/PromptHistory';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import { ThreadOpening } from '@runlith/chat-ui/session/ThreadOpening.svelte';
import { ThreadSession } from '@runlith/chat-ui/session/ThreadSession.svelte';
import { type ChatTurnFailure, TurnCommands } from '@runlith/chat-ui/session/TurnCommands.svelte';
import { ChatConnection } from '@runlith/chat-ui/wire/ChatConnection';
import type { ThreadBirth } from './birth/ThreadBirth.svelte.js';
import type { Draft, ThreadDraft } from './Draft.svelte.js';
import type { Runner } from './Runner.js';
import type { ThreadChat } from './ThreadChats.js';

export class ChatHold {
  target = $state.raw<ThreadSession<WireThread> | ThreadOpening>(new ThreadOpening());
  session = $derived(this.target instanceof ThreadSession ? this.target : null);
  readonly commands: TurnCommands<Draft, WireThread>;
  readonly birth: ThreadBirth;

  constructor(
    private readonly chat: ThreadChat,
    private readonly runner: Runner,
    draft: ThreadDraft,
    makeBirth: (hold: ChatHold) => ThreadBirth,
    noticeOf: (failure: ChatTurnFailure<Draft>) => ChatNotice | null,
    history: PromptHistory,
    private readonly handlers: ChatEntryHandlers,
  ) {
    this.birth = makeBirth(this);
    this.target = this.opening();
    this.commands = this.now(
      TurnCommands.make<Draft, WireThread>(
        chat.pending,
        chat.stops,
        chat.shaping,
        draft,
        this.birth,
        noticeOf,
        (work, otherwise) => this.run(work, otherwise),
        history,
      ),
    );
    this.now(this.commands.aim(this.target));
  }

  show(session: ThreadSession<WireThread> | null): void {
    this.target = session ?? this.opening();
    this.now(this.commands.aim(this.target));
  }

  run<A>(effect: Effect.Effect<A, never, ChatConnection<WireThread>>, otherwise: A): Promise<A> {
    return this.runner.settle(this.provided(effect)).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      if (Cause.hasInterruptsOnly(exit.cause)) return otherwise;
      const defect = Cause.squash(exit.cause);
      this.commands.say({ tone: 'error', message: defect instanceof Error ? defect.message : String(defect) });
      return Effect.runPromise(Effect.logError(exit.cause)).then(() => otherwise);
    });
  }

  forgetReturn(threadId: string): void {
    this.chat.stops.forgetReturn(threadId);
  }

  private opening(): ThreadOpening {
    return new ThreadOpening(
      this.handlers,
      () => this.birth.openingCopy,
      () => this.birth.authority.modes,
    );
  }

  private now<A>(effect: Effect.Effect<A, never, Scope.Scope | ChatConnection<WireThread>>): A {
    return Effect.runSync(this.provided(effect).pipe(Scope.provide(this.runner.life)));
  }

  private provided<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, ChatConnection<WireThread>>> {
    return Effect.provideService(effect, ChatConnection<WireThread>(), this.chat.port);
  }
}
