import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import type { Notification } from '@tagma/server/notify/contract/wire/notification';
import type { AttentionRow } from '@tagma/server/threads/contract/wire/attention';
import type { ThreadAskOption } from '@tagma/server/threads/contract/wire/list';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { applyAttention, applyNotifications, countsOf, NONE, notificationCountsOf, toldOf, unreadOf, type AttentionRows } from './rows.js';

export type Reply = { readonly state: 'sending' | 'sent' } | { readonly state: 'refused'; readonly reason: string };

function standing(replies: ReadonlyMap<string, Reply>, rows: readonly AttentionRow[]): ReadonlyMap<string, Reply> {
  if (replies.size === 0) return replies;
  const live = new Set(rows.map((row) => row.eventId));
  const kept = [...replies].filter(([eventId]) => live.has(eventId));
  return kept.length === replies.size ? replies : new Map(kept);
}

function standingNotices(replies: ReadonlyMap<string, Reply>, rows: readonly Notification[]): ReadonlyMap<string, Reply> {
  if (replies.size === 0) return replies;
  const live = new Set(rows.map((row) => row.id));
  const kept = [...replies].filter(([id]) => live.has(id));
  return kept.length === replies.size ? replies : new Map(kept);
}

export class Attention extends Service<Attention>()('Attention', { tier: 'app' }) {
  static *make() {
    return new Attention(yield* Live, yield* Door, yield* Scope);
  }

  held = $state.raw<AttentionRows>(NONE);
  marking = $state(false);
  private threadsKnown = $state(false);
  private noticesKnown = $state(false);
  private threadsProblem = $state<string | null>(null);
  private noticesProblem = $state<string | null>(null);
  private actionProblem = $state<string | null>(null);
  private replies = $state.raw<ReadonlyMap<string, Reply>>(new Map());

  constructor(
    private readonly live: LiveConnection,
    private readonly door: Door,
    scope: Scope,
  ) {
    super();
    const feed = live.hold(
      (client) => client['attention.subscribe']({}),
      (event) => {
        this.held = applyAttention(this.held, event);
        this.replies = standing(this.replies, this.held.rows);
        this.threadsKnown = true;
        this.threadsProblem = null;
        this.actionProblem = null;
      },
      (failure) => {
        if (failure.kind === 'subscription') this.threadsProblem = failure.message;
      },
    );
    scope.defer(() => feed.unsubscribe());
    const notices = live.hold(
      (client) => client['notifications.subscribe']({}),
      (event) => {
        this.notified = applyNotifications(this.notified, event);
        this.noticeReplies = standingNotices(this.noticeReplies, this.notified);
        this.noticesKnown = true;
        this.noticesProblem = null;
      },
      (failure) => {
        if (failure.kind === 'subscription') this.noticesProblem = failure.message;
      },
    );
    scope.defer(() => notices.unsubscribe());
  }

  get known(): boolean {
    return this.threadsKnown && this.noticesKnown;
  }

  get problem(): string | null {
    return this.threadsProblem ?? this.noticesProblem ?? this.actionProblem;
  }

  notified = $state.raw<readonly Notification[]>([]);
  private noticeReplies = $state.raw<ReadonlyMap<string, Reply>>(new Map());

  noticeCounts = $derived(notificationCountsOf(this.notified));

  noticeReplyOf(row: Notification): Reply | null {
    return this.noticeReplies.get(row.id) ?? null;
  }

  answerNotice(row: Notification, value: string): Promise<void> {
    return this.settleNotice(row, () => this.door.perform('answer_notification', { id: row.id, value }, {}));
  }

  dismissNotice(row: Notification): Promise<void> {
    return this.settleNotice(row, () => this.door.perform('dismiss_notification', { id: row.id }, {}));
  }

  private async settleNotice(row: Notification, act: () => Promise<unknown>): Promise<void> {
    if (this.noticeReplies.get(row.id)?.state === 'sending') return;
    this.noticeReply(row.id, { state: 'sending' });
    try {
      await act();
      this.noticeReply(row.id, { state: 'sent' });
    } catch (error) {
      this.noticeReply(row.id, { state: 'refused', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  private noticeReply(id: string, reply: Reply): void {
    this.noticeReplies = new Map(this.noticeReplies).set(id, reply);
  }

  get rows(): readonly AttentionRow[] {
    return this.held.rows;
  }

  get hidden(): number {
    return Math.max(0, this.held.total - this.held.rows.length);
  }

  counts = $derived.by(() => {
    const threads = countsOf(this.held.rows);
    return { ...threads, awaiting: threads.awaiting + this.noticeCounts.asking, finished: threads.finished + this.noticeCounts.telling };
  });

  replyOf(row: AttentionRow): Reply | null {
    return this.replies.get(row.eventId) ?? null;
  }

  async answer(row: AttentionRow, option: ThreadAskOption): Promise<void> {
    const ask = row.ask;
    const held = this.replyOf(row);
    if (ask === null || held?.state === 'sending' || held?.state === 'sent') return;
    this.reply(row.eventId, { state: 'sending' });
    try {
      await this.live.call((client) =>
        client['thread.answer']({
          projectId: row.project.id,
          threadId: row.threadId,
          params: { questionId: ask.questionId, answers: option.answers },
        }),
      );
      this.reply(row.eventId, { state: 'sent' });
    } catch (error) {
      this.reply(row.eventId, { state: 'refused', reason: error instanceof Error ? error.message : String(error) });
    }
  }

  private reply(eventId: string, reply: Reply): void {
    this.replies = new Map(this.replies).set(eventId, reply);
  }

  unreadIn(rows: readonly AttentionRow[], notices: readonly Notification[]): number {
    return unreadOf(rows).length + toldOf(notices).length;
  }

  async markRead(rows: readonly AttentionRow[], notices: readonly Notification[]): Promise<void> {
    const unread = unreadOf(rows);
    const told = toldOf(notices);
    if (this.marking || unread.length + told.length === 0) return;
    this.marking = true;
    this.actionProblem = null;
    const [answers] = await Promise.all([
      Promise.allSettled(
        unread.map((row) =>
          this.door.perform(
            'mark_thread_seen',
            { threadId: ThreadId.make(row.threadId), runId: row.runId },
            { project: String(row.project.id) },
          ),
        ),
      ),
      Promise.all(told.map((row) => this.dismissNotice(row))),
    ]);
    this.marking = false;
    const refused = answers.find((answer): answer is PromiseRejectedResult => answer.status === 'rejected');
    if (refused !== undefined) this.actionProblem = refused.reason instanceof Error ? refused.reason.message : String(refused.reason);
  }
}
