import { ChatFold, type ChatStreamTurn } from '../ChatFold.svelte';
import { CHAT_THREAD_UNBORN, type ChatThreadPhase } from '../chatThreadPhase';
import type { ChatEntryHandlers } from '../entries';
import type { ThreadModes } from '../wire/ChatConnection';
import type { PendingTurn } from './PendingTurns';

export type ThreadOpeningPhase = 'unborn' | 'opening' | 'unreadable';

export type ThreadOpeningCopy = {
  readonly title?: string;
  readonly detail?: string;
  readonly starters: readonly string[];
};

const NO_COPY: ThreadOpeningCopy = { starters: [] };

export class ThreadOpening {
  readonly fold: ChatFold;
  phase = $state<ThreadOpeningPhase>('unborn');
  readonly threadPhase: ChatThreadPhase = CHAT_THREAD_UNBORN;
  private readonly bubbles = new Map<string, ChatStreamTurn>();

  constructor(
    handlers?: ChatEntryHandlers,
    private readonly copyOf: () => ThreadOpeningCopy = () => NO_COPY,
    private readonly modesOf: () => ThreadModes | null = () => null,
  ) {
    this.fold = new ChatFold(handlers);
  }

  get copy(): ThreadOpeningCopy {
    return this.copyOf();
  }

  get modes(): ThreadModes | null {
    return this.modesOf();
  }

  show(turn: PendingTurn): void {
    this.phase = 'opening';
    if (!turn.bubble || this.bubbles.has(turn.inputId)) return;
    const previews = turn.opening.previews;
    this.bubbles.set(
      turn.inputId,
      this.fold.beginUserMessage({
        text: turn.opening.text,
        turnKey: turn.inputId,
        attachments: previews?.length ? previews : undefined,
      }),
    );
  }

  late(): void {
    this.phase = 'unreadable';
  }

  settle(inputId: string): void {
    const turn = this.bubbles.get(inputId);
    this.bubbles.delete(inputId);
    if (turn) this.fold.retract(turn);
    if (this.bubbles.size === 0) this.phase = 'unborn';
  }
}
