import type { ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import { Cause, Effect, Exit } from 'effect';
import { untrack } from 'svelte';
import type { ChatRewind, ChatRewindPoint } from '@runlith/chat-ui/rewind';
import type { RewindOps } from './RewindOps.js';
import type { ChatTakenWords } from '@runlith/chat-ui/ChatDraft';
import type { Births } from '../Births.svelte.js';
import type { ChatHold } from '../ChatHold.svelte.js';
import type { ThreadDraft } from '../Draft.svelte.js';
import type { ShownThread } from '../ShownThread.js';
import { ThreadFeed } from '../thread/ThreadFeed.svelte.js';
import type { ThreadWrites } from '../ThreadWrites.js';
import { ThreadRefused } from '../thread/ThreadRefused.js';
import { rewindWords } from './strings.js';

export type RewindPreview = Effect.Success<ReturnType<RewindOps['preview']>>;
type RewindPoints = Effect.Success<ReturnType<RewindOps['points']>>;

export type RewindAsk = {
  readonly threadId: string;
  readonly runId: string;
  readonly scope: ThreadRewindScope;
  readonly read: RewindPreview;
};

type Go = { readonly revertLines: boolean };

const BLOCKED: Readonly<Record<string, string>> = {
  'rewind-summarized': 'Summarized by a compaction',
  'rewind-rewound': 'Already rewound',
  'rewind-unknown': 'Not a turn of this thread',
};

export class Rewinds implements ChatRewind {
  readonly words = rewindWords;
  busy = $state(false);
  asking = $state.raw<RewindAsk | null>(null);
  private standing = $state.raw<{ readonly threadId: string; readonly read: RewindPoints } | null>(null);
  private answer: ((go: Go | null) => void) | null = null;
  private reads = 0;
  private closed = false;
  private readonly read = $derived.by(() => (this.standing?.threadId === this.shown.id && this.offered ? this.standing.read : null));
  private readonly points = $derived(new Map((this.read?.points ?? []).map((point) => [point.runId, point])));
  private readonly restorables = $derived(
    new Set((this.read?.rewinds ?? []).filter((rewind) => rewind.restorable).map((rewind) => rewind.rewindId)),
  );

  constructor(
    private readonly shown: ShownThread,
    private readonly chat: ChatHold,
    private readonly draft: ThreadDraft,
    private readonly writes: ThreadWrites,
    private readonly ops: RewindOps,
    private readonly births: Births,
  ) {}

  watch(): void {
    const threadId = this.shown.id;
    untrack(() => {
      if (this.asking !== null && this.asking.threadId !== threadId) this.settle(null);
    });
    if (threadId === null || !this.offered || (this.chat.session?.activeRunId ?? null) !== null) return;
    void this.readPoints(threadId);
  }

  get offered(): boolean {
    const thread = this.shown.lease?.get(ThreadFeed).chatThread ?? null;
    return thread !== null && thread.capabilities.history !== 'none' && thread.capabilities.copies?.point !== 'none';
  }

  point(runId: string): ChatRewindPoint | undefined {
    const point = this.points.get(runId);
    if (point === undefined) return undefined;
    return point.rewindable ? { rewindable: true } : { rewindable: false, why: BLOCKED[point.reason] ?? point.reason };
  }

  restorable(rewindId: string): boolean {
    return this.restorables.has(rewindId);
  }

  async rewind(runId: string, scope: ThreadRewindScope): Promise<boolean> {
    const threadId = this.shown.id;
    if (threadId === null || this.busy) return false;
    this.busy = true;
    try {
      const read = await this.call(this.ops.preview(threadId, runId, scope));
      const go = beyondWords(read) ? await this.ask({ threadId, runId, scope, read }) : { revertLines: false };
      if (go === null || this.shown.id !== threadId) return false;
      const answer = await this.call(this.ops.rewind(threadId, runId, scope, go.revertLines));
      if (this.shown.id !== threadId) return true;
      if (scope === 'from') {
        const taken = answer.drafts.filter((_, index) => answer.taken[index]?.kind !== 'compaction').map(sent);
        await this.takeBack(threadId, [...(answer.draft === null ? [] : [sent(answer.draft)]), ...taken]);
      }
      if (answer.reverted?.status === 'refused') this.say(threadId, answer.reverted.reason);
      void this.readPoints(threadId);
      return true;
    } catch (error) {
      this.say(threadId, reasonOf(error));
      return false;
    } finally {
      this.busy = false;
    }
  }

  confirm(revertLines: boolean): void {
    this.settle({ revertLines });
  }

  cancel(): void {
    this.settle(null);
  }

  restore(rewindId: string): void {
    const threadId = this.shown.id;
    if (threadId === null || this.busy) return;
    this.busy = true;
    void this.call(this.ops.restore(threadId, rewindId))
      .catch((error: unknown) => this.say(threadId, reasonOf(error)))
      .finally(() => {
        this.busy = false;
        void this.readPoints(threadId);
      });
  }

  branch(runId: string): void {
    const threadId = this.shown.id;
    if (threadId === null || this.busy) return;
    this.busy = true;
    const source = this.births.listed(threadId) ??
      this.shown.row ?? {
        id: threadId,
        projectId: this.shown.projectId,
        title: this.shown.identity?.title ?? '',
        agentId: '',
        provider: '',
        model: null,
        reasoning: null,
      };
    void this.births
      .fork(source, () => this.call(this.ops.branch(threadId, runId)))
      .then(async (answer) => {
        if (answer === null) return;
        this.writes.open(answer.threadId);
        if (answer.draft !== null) await this.takeBack(answer.threadId, [sent(answer.draft)]);
      })
      .catch((error: unknown) => this.say(threadId, reasonOf(error)))
      .finally(() => {
        this.busy = false;
      });
  }

  dispose(): void {
    this.closed = true;
    this.settle(null);
  }

  private ask(asked: RewindAsk): Promise<Go | null> {
    if (this.closed) return Promise.resolve(null);
    this.settle(null);
    this.asking = asked;
    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  private settle(go: Go | null): void {
    const answer = this.answer;
    this.answer = null;
    this.asking = null;
    answer?.(go);
  }

  private async call<A>(work: Effect.Effect<A, ThreadRefused>): Promise<A> {
    const exit = await this.writes.attempt(work);
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  }

  private async takeBack(threadId: string, words: readonly ChatTakenWords[]): Promise<void> {
    this.chat.forgetReturn(threadId);
    const put = await this.writes.attempt(this.draft.takeBack(this.draft.key, words));
    if (Exit.isSuccess(put) && put.value !== null) this.say(threadId, put.value.message);
  }

  private async readPoints(threadId: string): Promise<void> {
    const asked = ++this.reads;
    const exit = await this.writes.attempt(
      this.ops
        .points(threadId)
        .pipe(Effect.catchTag('ThreadRefused', (refusal) => Effect.logWarning(refusal.message).pipe(Effect.as(null)))),
    );
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) throw Cause.squash(exit.cause);
    const read = Exit.isSuccess(exit) ? exit.value : null;
    if (read !== null && !this.closed && asked === this.reads && this.shown.id === threadId) this.standing = { threadId, read };
  }

  private say(threadId: string, reason: string): void {
    if (this.shown.id === threadId) this.chat.commands.say({ tone: 'error', message: reason });
  }
}

export function beyondWords(read: RewindPreview): boolean {
  return (
    read.files.total > 0 ||
    read.files.unavailable !== null ||
    read.graph.acts.length > 0 ||
    read.graph.unread.length > 0 ||
    read.preview.running !== null ||
    read.preview.taken.length > 0 ||
    read.preview.children.some((child) => child.running)
  );
}

function sent(draft: { readonly text: string; readonly attachments?: ChatTakenWords['attachments'] }): ChatTakenWords {
  return { text: draft.text, attachments: draft.attachments ?? [] };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
