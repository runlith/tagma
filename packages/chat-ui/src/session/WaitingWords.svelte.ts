import { Effect, type Fiber, Result } from 'effect';
import type { ChatDraft, ChatTakenWords } from '../ChatDraft';
import type { ChatNotice, ChatTold } from '../notice';
import { type ChatCommandFailure, type ChatConnection, type ChatThreadView, refusedTold } from '../wire/ChatConnection';
import type { ChatQueuedTurnItem } from './FeedVerdicts';
import type { PendingTurns } from './PendingTurns';
import type { ThreadSession } from './ThreadSession.svelte';

export type WaitingFailure =
  | { readonly kind: 'unqueue-refused'; readonly message: string; readonly told?: ChatTold | undefined }
  | { readonly kind: 'promote-refused'; readonly message: string; readonly told?: ChatTold | undefined }
  | { readonly kind: 'take-unsure'; readonly message: string }
  | { readonly kind: 'send-lost'; readonly message: string }
  | { readonly kind: 'command-lost'; readonly message: string };

type Act = 'delete' | 'edit' | 'promote';

export class WaitingWords<TDraft, TThread extends ChatThreadView> {
  private taking = $state<string | undefined>();

  constructor(
    private readonly connection: ChatConnection<TThread>,
    private readonly turns: PendingTurns,
    private readonly draft: ChatDraft<TDraft>,
    private readonly session: () => ThreadSession<TThread> | null,
    private readonly notice: (failure: WaitingFailure) => ChatNotice | null,
    private readonly post: (session: ThreadSession<TThread>, notice: ChatNotice) => void,
    private readonly fork: (work: Effect.Effect<void>) => Fiber.Fiber<void>,
  ) {}

  get busy(): string | undefined {
    return this.taking;
  }

  unqueue(inputId: string): Effect.Effect<void> {
    return this.takeOut(inputId, 'delete');
  }

  edit(inputId: string): Effect.Effect<void> {
    return this.takeOut(inputId, 'edit');
  }

  promote(inputId: string): Effect.Effect<void> {
    return this.takeOut(inputId, 'promote');
  }

  private takeOut(inputId: string, act: Act): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.session();
      if (!session || this.taking) return Effect.void;
      const item = session.waiting(inputId);
      const key = this.draft.key;
      const words = item === undefined ? null : { text: item.text, attachments: item.attachments };
      this.taking = inputId;
      const taken = Effect.flatMap(Effect.result(this.connection.unqueue(session.threadId, inputId)), (result) => {
        if (Result.isFailure(result)) return this.untaken(result.failure, act === 'delete' ? null : words, key);
        if (result.success.status !== 'unqueued') return Effect.succeed(null);
        session.unqueued(inputId);
        if (act === 'delete' || item === undefined || words === null) return Effect.succeed(null);
        return act === 'edit' ? this.draft.takeBack(key, [words]) : this.resay(session, item, key);
      });
      return this.turns.carry(taken).pipe(
        Effect.map((notice) => {
          if (notice !== null) this.post(session, notice);
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.taking === inputId) this.taking = undefined;
          }),
        ),
      );
    });
  }

  private untaken(failure: ChatCommandFailure, words: ChatTakenWords | null, key: string): Effect.Effect<ChatNotice | null> {
    if (failure._tag === 'ChatCommandRefused')
      return Effect.succeed(this.notice({ kind: 'unqueue-refused', message: failure.message, told: failure.told }));
    if (words === null) return Effect.succeed(this.notice({ kind: 'command-lost', message: failure.message }));
    return Effect.as(this.draft.takeBack(key, [words]), this.notice({ kind: 'take-unsure', message: failure.message }));
  }

  private resay(session: ThreadSession<TThread>, item: ChatQueuedTurnItem, key: string): Effect.Effect<ChatNotice | null> {
    return Effect.suspend(() => {
      const inputId = crypto.randomUUID();
      const words = { text: item.text, attachments: item.attachments };
      const refs = item.attachments.flatMap((attachment) => (attachment.id === undefined ? [] : [{ id: attachment.id }]));
      this.turns.begin({
        inputId,
        threadId: session.threadId,
        draftKey: key,
        opening: { text: item.text, previews: item.attachments.length > 0 ? item.attachments : undefined },
        bubble: false,
        stored: item.attachments.length > 0 ? item.attachments.map(({ mime, url, filename }) => ({ mime, url, filename })) : undefined,
        giveBack: (into) => void this.fork(Effect.asVoid(this.draft.takeBack(into, [words]))),
      });
      const said = { text: item.text, key: inputId, attachments: refs.length > 0 ? refs : undefined };
      return Effect.map(this.turns.deliver(inputId, session.threadId, said, false), (delivery) => {
        if (delivery.kind === 'accepted') return null;
        if (delivery.kind === 'lost') return this.notice({ kind: 'send-lost', message: delivery.failure.message });
        return this.notice({ kind: 'promote-refused', message: delivery.failure.message, told: refusedTold(delivery.failure) });
      });
    });
  }
}
