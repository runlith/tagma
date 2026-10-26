import { untrack } from 'svelte';
import type { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import type { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { timeCompact } from '$lib/shared/time.js';
import { threadMark, type ThreadMark } from './Life.svelte';
import { failedRowDetail } from './native/runEndingLine.js';
import { runningSinceOf } from './rowKind.js';
import { TEAM_NAMED, type ThreadTreeNode } from './forest.js';
import type { WorkInput } from './workLine.js';
import type { WorkLines } from './workLines.svelte.js';

export type RowLine = { readonly text: string; readonly tone: string; readonly elapsed: string | null };

function firstLine(text: string | null | undefined): string | null {
  return (
    text
      ?.split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? null
  );
}

export class RowReading {
  readonly mark: ThreadMark;
  readonly own: RowLine | null;
  readonly team: RowLine | null;
  readonly said: string | null;
  readonly time: string;
  readonly timeTone: string;
  readonly ticking: boolean;

  constructor(
    private readonly node: () => ThreadTreeNode,
    private readonly clock: WallClock,
    private readonly lines: WorkLines,
    private readonly catalog: ProviderCatalog,
  ) {
    const row = $derived(node().row);
    this.mark = $derived(threadMark(row));
    const work = $derived<WorkInput | null>(
      this.mark.state === 'working' && row.phase !== null
        ? { phase: row.phase.phase, since: row.phase.since, waiting: row.phase.waiting, calls: row.phase.calls, queued: row.phase.queued }
        : null,
    );
    const doing = $derived(work === null ? null : this.lines.shown(row.id));

    $effect(() => {
      const input = work;
      const id = row.id;
      untrack(() => this.lines.follow(id, input));
    });
    $effect(() => {
      const id = untrack(() => row.id);
      return () => this.lines.release(id);
    });

    this.own = $derived.by<RowLine | null>(() => {
      if (row.launchBlocked === true) {
        const why = row.outcome?.failureReason;
        return {
          text: why ? `launch blocked — ${why}` : 'launch blocked — a new word tries again',
          tone: 'text-destructive',
          elapsed: null,
        };
      }
      if (row.halt !== undefined) return { text: row.halt.reason, tone: 'text-destructive', elapsed: null };
      switch (this.mark.state) {
        case 'stalled':
          return { text: 'no movement for a long time', tone: 'text-destructive', elapsed: null };
        case 'working':
          return doing === null
            ? null
            : {
                text: doing.text,
                tone: doing.view.kind === 'phase' || doing.view.kind === 'opening' ? 'text-muted-foreground/70' : 'text-muted-foreground',
                elapsed: doing.elapsed,
              };
        case 'waiting':
          return {
            text: firstLine(row.ask?.text) ?? 'waiting on you',
            tone: 'text-status-open',
            elapsed: null,
          };
        case 'failed': {
          const outcome = row.outcome;
          if (outcome === null) return null;
          return {
            text: failedRowDetail(this.catalog.models, outcome.failure, outcome.failureReason),
            tone: 'text-destructive',
            elapsed: null,
          };
        }
        case 'cut':
          return { text: 'cut short — continue', tone: 'text-status-in-work', elapsed: null };
        case 'unread': {
          const said = firstLine(row.saidLine);
          return said === null ? null : { text: said, tone: 'text-foreground/70', elapsed: null };
        }
        case 'quiet':
          return null;
      }
    });

    this.said = $derived(firstLine(row.saidLine));

    this.team = $derived.by<RowLine | null>(() => {
      const { workers, working } = node().team;
      if (working === 0) return null;
      const more = working - TEAM_NAMED;
      return {
        text: `${workers.join(', ')}${more > 0 ? ` +${more}` : ''}`,
        tone: 'text-muted-foreground',
        elapsed: null,
      };
    });

    const runningSince = $derived(runningSinceOf(node().row));
    const waitingSince = $derived(
      this.mark.state !== 'waiting' ? null : (row.ask?.askedAt ?? row.activeRunStartedAt ?? row.liveSpellStartedAt),
    );
    const since = $derived(runningSince ?? waitingSince);
    this.ticking = $derived(since !== null);
    this.time = $derived(since === null ? timeCompact(node().lastEventAt, this.clock.minuteNow) : timeCompact(since, this.clock.now, true));
    this.timeTone = $derived(
      runningSince !== null ? 'text-status-in-work' : waitingSince !== null ? 'text-status-open' : 'text-muted-foreground/70',
    );

    $effect(() => (this.ticking ? this.clock.watch() : this.clock.watchMinutes()));
  }
}
