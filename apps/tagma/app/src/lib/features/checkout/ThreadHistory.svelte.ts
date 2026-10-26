import type { TurnPath } from '@tagma/server/change-record/contract/wire/changes';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { ProjectDoor } from '$lib/features/workspace/ProjectDoor.js';
import { refusalOf, type Refusal } from '$lib/wire/refusal.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';

export const HISTORY_PAGE = 200;

export type HistoryTurn = { readonly runId: string | null; readonly at: number; readonly paths: readonly TurnPath[] };

export type HistoryReading =
  | { readonly _tag: 'reading' }
  | { readonly _tag: 'read' }
  | { readonly _tag: 'failed'; readonly refusal: Refusal };

type Window = { readonly turns: readonly TurnPath[]; readonly total: number; readonly next: string | null };

export function turnsOf(paths: readonly TurnPath[]): readonly HistoryTurn[] {
  const turns: { runId: string | null; at: number; paths: TurnPath[] }[] = [];
  for (const path of paths) {
    const last = turns.at(-1);
    if (last !== undefined && last.runId !== null && last.runId === path.runId) last.paths.push(path);
    else turns.push({ runId: path.runId, at: path.at, paths: [path] });
  }
  return turns;
}

export class ThreadHistory extends Service<ThreadHistory>()('ThreadHistory', { tier: 'thread' }) {
  static *make() {
    const history = new ThreadHistory(yield* ProjectDoor, (yield* ThreadRung.Current).id, yield* ThreadChanges);
    (yield* Scope).defer(history.watch());
    return history;
  }

  paths = $state.raw<readonly TurnPath[]>([]);

  total = $state(0);

  reading = $state<HistoryReading>({ _tag: 'reading' });

  private next = $state<string | null>(null);

  readonly turns: readonly HistoryTurn[] = $derived(turnsOf(this.paths));

  readonly more: boolean = $derived(this.next !== null);

  private followers = $state(0);

  private running = false;

  private again = false;

  constructor(
    private readonly door: ProjectDoor,
    private readonly threadId: string,
    private readonly changes: ThreadChanges,
  ) {
    super();
  }

  follow(): () => void {
    this.followers = untrack(() => this.followers) + 1;
    return () => {
      this.followers = untrack(() => this.followers) - 1;
    };
  }

  showMore(): void {
    const from = this.next;
    if (from === null || this.running) return;
    void this.run(async () => {
      const page = await this.page(from);
      this.paths = [...this.paths, ...page.turns];
      this.total = page.total;
      this.next = page.next;
    });
  }

  retry(): void {
    this.refresh();
  }

  watch(): () => void {
    return $effect.root(() => {
      $effect(() => {
        if (this.followers === 0) return;
        void this.changes.moved;
        untrack(() => this.refresh());
      });
    });
  }

  private refresh(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    const wanted = Math.max(HISTORY_PAGE, this.paths.length);
    void this.run(async () => {
      let window = await this.page(null);
      let paths = [...window.turns];
      while (window.next !== null && paths.length < wanted) {
        window = await this.page(window.next);
        paths = [...paths, ...window.turns];
      }
      this.paths = paths;
      this.total = window.total;
      this.next = window.next;
    });
  }

  private async run(read: () => Promise<void>): Promise<void> {
    this.running = true;
    try {
      await read();
      this.reading = { _tag: 'read' };
    } catch (error) {
      this.reading = { _tag: 'failed', refusal: refusalOf(error) };
    } finally {
      this.running = false;
    }
    if (this.again) {
      this.again = false;
      this.refresh();
    }
  }

  private async page(cursor: string | null): Promise<Window> {
    const read = await this.door.perform('read_thread_history', {
      threadId: this.threadId,
      limit: HISTORY_PAGE,
      cursor: cursor ?? undefined,
    });
    return { turns: read.turns, total: read.total, next: read.next };
  }
}
