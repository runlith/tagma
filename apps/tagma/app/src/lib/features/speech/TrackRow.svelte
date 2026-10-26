<script lang="ts">
  import Told from '$lib/shared/Told.svelte';
  import { levelDb, levelFill, type Fault, type TrackView } from './check.js';
  import { told } from './words.js';

  let {
    source,
    view,
    fault,
    running,
  }: {
    source: 'mic' | 'system';
    view: TrackView | undefined;
    fault: Fault | null;
    running: boolean;
  } = $props();

  const PHASES = {
    connecting: 'Connecting',
    live: 'Listening',
    waiting: 'Waiting to reconnect',
    finished: 'Finished',
    ended: 'Ended',
    failed: 'Failed',
  } as const;

  const db = $derived(view === undefined ? -Infinity : levelDb(view.peak));
  const message = $derived(fault === null ? null : told(fault, source));
</script>

<div class="grid gap-2 border-t border-vein py-3 first:border-t-0" data-track={source}>
  <div class="flex flex-wrap items-center gap-3">
    <span class="text-ui font-medium">{source === 'mic' ? 'Microphone' : 'System audio'}</span>
    <span class="text-small text-muted-foreground">
      {view === undefined
        ? running
          ? 'Starting'
          : 'Not running'
        : view.phase === null
          ? view.levelAt === null
            ? 'Starting'
            : 'Receiving sound'
          : PHASES[view.phase]}
    </span>
  </div>
  <div class="flex items-center gap-3">
    <div
      class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-vein-strong"
      role="meter"
      aria-label="{source} level"
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Number.isFinite(db) ? db : -60}
    >
      <div
        class="h-full rounded-full bg-status-done transition-[width] duration-100"
        style:width="{(view === undefined ? 0 : levelFill(view.peak)) * 100}%"
      ></div>
    </div>
    <span class="w-16 shrink-0 text-right text-small tabular-nums text-muted-foreground">
      {Number.isFinite(db) ? `${Math.round(db)} dB` : '–∞ dB'}
    </span>
  </div>
  {#if message !== null}
    <div class="grid gap-0.5 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2" role="alert">
      <span class="text-ui font-medium text-destructive">{message.title}</span>
      <span class="text-small leading-relaxed text-muted-foreground">{message.detail}</span>
      {#if message.details !== undefined && message.details.length > 0}
        <Told told={{ text: '', details: message.details }} />
      {/if}
    </div>
  {/if}
</div>
