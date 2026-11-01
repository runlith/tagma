import type { JournalBatch, JournalSelection, JournalSession, JournalVocabulary } from '@tagma/server/graph/contract/wire/journal';
import type { BlockDiff, BlockMark } from '@tagma/server/graph/contract/wire/reads';
import type { Block } from '@tagma/server/graph/contract/wire/rows';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { Screen } from '@runlith/layer/svelte/screen.svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import { JournalLive } from './Live.svelte.js';
import { batchKey, batchRange, type JournalRun, journalRows } from './rows.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { GraphFeed } from '$lib/features/graph/Feed.js';
import { JournalRepo } from '$lib/features/graph/JournalRepo.js';

const PAGE_ENTRIES = 100;

export type OpenedBatch = { diff: BlockDiff; marks: readonly BlockMark[]; blocks: readonly Block[] };

export class JournalScreen extends Screen<JournalScreen>()('JournalScreen', { tier: 'graph' }) {
  static override *make() {
    const platform = yield* Platform;
    return new JournalScreen(
      (yield* GraphRung.Current).projectId,
      yield* JournalRepo,
      yield* BlocksRepo,
      yield* JournalLive,
      yield* GraphFeed,
      yield* Scope,
      yield* Notices,
      platform.storage.local,
    );
  }

  headBatches = $state<readonly JournalBatch[]>([]);
  olderBatches = $state<readonly JournalBatch[]>([]);
  readonly rows = $derived(journalRows([...this.headBatches, ...this.olderBatches]));
  readonly entries = $derived(
    this.headBatches.reduce((sum, batch) => sum + batch.entries, 0) + this.olderBatches.reduce((sum, batch) => sum + batch.entries, 0),
  );
  readonly blocks = new SvelteMap<string, Block>();
  readonly sessions = new SvelteMap<number, JournalSession>();
  cursor = $state<number | null>(null);
  loaded = $state(false);
  vocabulary = $state<JournalVocabulary>({ sessions: [], ops: [], tags: [] });

  readonly selectedTags = new SvelteSet<string>();
  readonly selectedSessions = new SvelteSet<string>();
  readonly selectedOps = new SvelteSet<string>();
  readonly selection = $derived<JournalSelection>({
    tags: [...this.selectedTags],
    sessions: [...this.selectedSessions].map(Number),
    ops: [...this.selectedOps],
  });
  readonly filtered = $derived(this.selectedTags.size + this.selectedSessions.size + this.selectedOps.size > 0);

  readonly openRuns = new SvelteSet<string>();
  readonly diffs = new SvelteMap<string, OpenedBatch>();

  readonly sessionMark: number;

  private scopeName = $state<string | null>(null);
  private headSince = 0;
  private primed = false;
  private loadingOlder = false;
  private generation = 0;
  private readonly filterKey: string;

  constructor(
    projectId: number,
    private readonly journal: JournalRepo,
    private readonly blocksRepo: BlocksRepo,
    private readonly live: JournalLive,
    feed: GraphFeed,
    scope: Scope,
    private readonly notices: Notices,
    private readonly storage: PlatformStorage,
  ) {
    super();
    this.sessionMark = live.seenId;
    this.filterKey = `tagma.journalFilter.${projectId}`;
    this.recallFilter();
    scope.defer(
      feed.frames(() => {
        void this.loadVocabulary(this.scopeName, this.generation);
        void (this.primed ? this.refresh(this.scopeName, this.selection) : this.prime(this.scopeName, this.selection));
      }),
    );
  }

  readAt(scopeName: string | null): void {
    this.scopeName = scopeName;
    const picked = this.selection;
    this.remember();
    this.loaded = false;
    this.primed = false;
    this.headBatches = [];
    this.olderBatches = [];
    this.blocks.clear();
    this.sessions.clear();
    this.cursor = null;
    this.generation += 1;
    void this.loadVocabulary(scopeName, this.generation);
    void this.prime(scopeName, picked);
  }

  clearFilter(): void {
    this.selectedTags.clear();
    this.selectedSessions.clear();
    this.selectedOps.clear();
  }

  toggleRun(run: JournalRun): void {
    if (this.openRuns.has(run.key)) {
      this.openRuns.delete(run.key);
      return;
    }
    this.openRuns.add(run.key);
    for (const batch of run.batches) this.readDiff(batch);
  }

  sessionOf(id: number | null): JournalSession | null | undefined {
    return id === null ? null : this.sessions.get(id);
  }

  private readDiff(batch: JournalBatch): void {
    const key = batchKey(batch);
    if (this.diffs.has(key)) return;
    void this.blocksRepo.diff
      .key({ name: batch.blockName, ...batchRange(batch) })
      .loadOrThrow()
      .then((result) => {
        if (result) this.diffs.set(key, result);
      })
      .catch((error: unknown) => this.notices.refusal(error));
  }

  async readOlder(): Promise<void> {
    const scopeName = this.scopeName;
    const before = this.cursor;
    if (before === null || this.loadingOlder) return;
    this.loadingOlder = true;
    const current = this.generation;
    try {
      const result = await this.window({ ...this.selection, scopeName: scopeName ?? undefined, before, limit: PAGE_ENTRIES }, false);
      if (current !== this.generation || !result) return;
      this.olderBatches = [...this.olderBatches, ...result.batches];
      this.keep(result.blocks);
      this.keepSessions(result.sessions);
      this.cursor = result.nextBefore;
    } catch (error) {
      if (current === this.generation) this.notices.refusal(error);
    } finally {
      this.loadingOlder = false;
    }
  }

  private window(input: Parameters<JournalRepo['batches']['key']>[0], fresh: boolean) {
    const query = this.journal.batches.key(input);
    return fresh ? query.refresh({ throwOnError: true }) : query.loadOrThrow();
  }

  private async prime(scopeName: string | null, picked: JournalSelection): Promise<void> {
    const current = this.generation;
    try {
      const result = await this.window({ ...picked, scopeName: scopeName ?? undefined, limit: PAGE_ENTRIES }, true);
      if (current !== this.generation || !result) return;
      this.headBatches = result.batches;
      this.olderBatches = [];
      this.keep(result.blocks);
      this.keepSessions(result.sessions);
      this.headSince = result.nextBefore ?? 0;
      this.cursor = result.nextBefore;
      this.primed = true;
      this.mark(scopeName, result.batches);
    } catch (error) {
      if (current === this.generation) this.notices.refusal(error);
    } finally {
      if (current === this.generation) this.loaded = true;
    }
  }

  private async refresh(scopeName: string | null, picked: JournalSelection): Promise<void> {
    const current = this.generation;
    try {
      const result = await this.window({ ...picked, scopeName: scopeName ?? undefined, since: this.headSince }, true);
      if (current !== this.generation || !result) return;
      this.headBatches = result.batches;
      this.keep(result.blocks);
      this.keepSessions(result.sessions);
      this.mark(scopeName, result.batches);
    } catch (error) {
      if (current === this.generation) this.notices.refusal(error);
    }
  }

  private async loadVocabulary(scopeName: string | null, generationAt: number): Promise<void> {
    try {
      const result = await this.journal.vocabulary.key(scopeName ?? undefined).refresh({ throwOnError: true });
      if (generationAt !== this.generation || !result) return;
      this.vocabulary = result;
      const named = new Set(result.sessions.map((row) => String(row.id)));
      for (const picked of [...this.selectedSessions]) if (!named.has(picked)) this.selectedSessions.delete(picked);
    } catch (error) {
      this.notices.refusal(error);
    }
  }

  private keep(rows: readonly Block[]): void {
    for (const row of rows) this.blocks.set(row.name, row);
  }

  private keepSessions(rows: readonly JournalSession[]): void {
    for (const row of rows) this.sessions.set(row.id, row);
  }

  private mark(scopeName: string | null, batches: readonly JournalBatch[]): void {
    const newest = batches[0];
    if (scopeName === null && !this.filtered && newest) this.live.markSeen(newest.lastEventId);
  }

  private recallFilter(): void {
    try {
      const stored = JSON.parse(this.storage.getItem(this.filterKey) ?? 'null') as {
        tags?: string[];
        sessions?: string[];
        ops?: string[];
      } | null;
      for (const tag of stored?.tags ?? []) this.selectedTags.add(tag);
      for (const session of stored?.sessions ?? []) this.selectedSessions.add(session);
      for (const op of stored?.ops ?? []) this.selectedOps.add(op);
    } catch {}
  }

  private remember(): void {
    const state = {
      tags: [...this.selectedTags],
      sessions: [...this.selectedSessions],
      ops: [...this.selectedOps],
    };
    if (state.tags.length === 0 && state.sessions.length === 0 && state.ops.length === 0) {
      this.storage.removeItem(this.filterKey);
    } else this.storage.setItem(this.filterKey, JSON.stringify(state));
  }
}
