import { Effect } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ChatTurnFailure, TurnCommands } from '@runlith/chat-ui/session/TurnCommands.svelte';
import type { CompactionChoice, CompactionChoicesRead } from '@tagma/server/native-harness/contract/wire/compactionChoices';
import { compactionSummarizerRule, compactionSummarizers } from '@tagma/server/native-harness/contract/wire/compactionSettings';
import { Service } from '@runlith/layer/key';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { spendBasis } from '$lib/features/providers/usage/spendWords.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { resolvedWords } from '../native/compactionWords.js';
import type { Draft } from '../Draft.svelte.js';
import { ThreadList } from '../List.svelte.js';
import { ThreadsRepo } from '../Repo.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { refusedBy, type ThreadRefused } from './ThreadRefused.js';

export class ThreadCompaction extends Service<ThreadCompaction>()('ThreadCompaction', { tier: 'thread' }) {
  static *make() {
    return new ThreadCompaction(
      yield* ThreadFeed,
      yield* ThreadEffects,
      yield* ThreadsRepo,
      yield* SettingsRepo,
      (yield* ProjectRung.Current).projectId,
      yield* UsageAccounts,
      yield* ThreadList,
      yield* ProviderCatalog,
    );
  }

  choices = $state.raw<CompactionChoicesRead | null>(null);
  unread = $state<string | null>(null);
  refusal = $state<string | null>(null);
  private asked: string | null = null;
  private readings = 0;
  private shown = false;
  private openings = 0;
  private compacting = false;

  constructor(
    private readonly feed: ThreadFeed,
    private readonly effects: ThreadEffects,
    private readonly threads: ThreadsRepo,
    private readonly settings: SettingsRepo,
    private readonly projectId: number,
    private readonly accounts: UsageAccounts,
    private readonly list: ThreadList,
    private readonly catalog: ProviderCatalog,
  ) {
    super();
  }

  resolvedWords(now: number): string | undefined {
    return this.choices === null ? undefined : resolvedWords(this.catalog.models, this.choices, now);
  }

  private chosen = $derived.by(() =>
    (this.settings.catalog.key(this.projectId).data?.entries ?? [])
      .filter((entry) => entry.id === compactionSummarizerRule.id || entry.id === compactionSummarizers.id)
      .map((entry) => JSON.stringify(entry.value))
      .join(';'),
  );

  private basis = $derived.by(() => {
    const session = this.feed.session;
    const thread = session.thread;
    const warmth = thread?.cacheWarmth ?? null;
    return [
      this.feed.threadId,
      thread?.provider,
      thread?.model,
      thread?.account,
      thread?.reasoning,
      warmth?.state,
      warmth?.invalidatedBy,
      session.activeRunId !== null,
      thread?.contextReading?.measuredAt,
      spendBasis(this.accounts.rows),
      this.chosen,
    ].join('|');
  });

  compact(commands: TurnCommands<Draft, WireThread>, at: 'step' | 'end', row: CompactionChoice | null): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.dismiss();
      this.compacting = true;
      const summarizer = row === null ? undefined : { provider: row.provider, model: row.model, reasoning: row.reasoning };
      return commands.compact(at, summarizer).pipe(
        Effect.asVoid,
        Effect.ensuring(
          Effect.sync(() => {
            this.compacting = false;
          }),
        ),
      );
    });
  }

  absorbs(failure: ChatTurnFailure<Draft>): boolean {
    if (!this.compacting || failure.kind !== 'compact-refused' || failure.code !== 'no-summarizer') return false;
    this.refusal = failure.message;
    return true;
  }

  dismiss(): void {
    this.refusal = null;
  }

  watch(asking: boolean): void {
    const wanted = asking || this.refusal !== null;
    if (!wanted) {
      this.shown = false;
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.openings += 1;
    }
    const thread = this.feed.session.thread;
    if (thread === null || this.list.row(this.feed.threadId)?.capabilities.compaction === 'none') return;
    const key = `${this.openings}|${this.basis}`;
    if (key === this.asked) return;
    this.asked = key;
    void this.effects.run(this.read());
  }

  private read(): Effect.Effect<void> {
    const sequence = ++this.readings;
    this.unread = null;
    return Effect.tryPromise({
      try: () => this.threads.compactionChoices.run({ id: this.feed.threadId, projectId: this.projectId }, { throwOnError: true }),
      catch: refusedBy,
    }).pipe(
      Effect.matchEffect({
        onSuccess: (read) =>
          Effect.sync(() => {
            if (sequence === this.readings && read !== undefined) this.choices = read;
          }),
        onFailure: (refusal: ThreadRefused) =>
          Effect.logWarning(refusal.message).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (sequence !== this.readings) return;
                this.asked = null;
                this.unread = refusal.message;
              }),
            ),
          ),
      }),
    );
  }
}
