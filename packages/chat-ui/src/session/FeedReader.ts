import { type FeedApply, type FeedHeld, step } from '@runlith/agent/transcript/feedFold';
import type { FeedPosition, ThreadLiveProgress } from '@runlith/agent/transcript/live';
import type { ChatFeedEvent, ChatState, ChatThreadView } from '../wire/ChatConnection';

export type FeedRead<TThread extends ChatThreadView> =
  | { readonly kind: 'applied'; readonly state: ChatState<TThread> | null; readonly progress: ThreadLiveProgress | null | undefined }
  | { readonly kind: 'gap' };

export interface FeedTarget {
  held(at: FeedPosition | null): FeedHeld;
  apply(ops: readonly FeedApply[]): void;
}

export class FeedReader<TThread extends ChatThreadView> {
  private heldAt: FeedPosition | null;
  private heldState: ChatState<TThread> | null;

  constructor(
    private readonly target: FeedTarget,
    resumed: { readonly at: FeedPosition; readonly state: ChatState<TThread> } | null = null,
  ) {
    this.heldAt = resumed?.at ?? null;
    this.heldState = resumed?.state ?? null;
  }

  get at(): FeedPosition | null {
    return this.heldAt;
  }

  get state(): ChatState<TThread> | null {
    return this.heldState;
  }

  read(event: ChatFeedEvent<TThread>): FeedRead<TThread> {
    const stepped = step(this.target.held(this.heldAt), event);
    if (stepped === 'gap') return { kind: 'gap' };
    this.target.apply(stepped.apply);
    this.heldAt = stepped.at;
    const state = stepped.state === null ? null : stateOf(stepped.state);
    if (state !== null) this.heldState = state;
    return { kind: 'applied', state, progress: progressOf(stepped.apply) };
  }
}

function stateOf<TThread extends ChatThreadView>(state: ChatState<TThread>): ChatState<TThread> {
  const { thread, modes, contextReading, contextLimit, activeRun, latestRun, pendingInput, status, now } = state;
  return {
    thread,
    modes,
    contextReading,
    contextLimit,
    activeRun,
    latestRun,
    pendingInput,
    status,
    now,
  };
}

function progressOf(apply: readonly FeedApply[]): ThreadLiveProgress | null | undefined {
  let progress: ThreadLiveProgress | null | undefined;
  for (const op of apply) if (op.op === 'reset' || op.op === 'progress') progress = op.progress;
  return progress;
}
