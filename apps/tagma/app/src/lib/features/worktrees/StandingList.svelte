<script lang="ts">
  import type { StandingInPlace } from './PlaceStanding.js';

  let { standing, lead = 'Ends what still runs here' }: { standing: StandingInPlace; lead?: string } = $props();
</script>

<div class="grid gap-0.5 text-ui" data-standing-list={standing.runs.length}>
  <span class="text-small font-medium text-muted-foreground">{lead}</span>
  {#each standing.runs as run (run.key)}
    <span class="flex min-w-0 items-baseline gap-1.5" data-standing-run={run.kind}>
      <span class="shrink-0 text-muted-foreground">{run.kind === 'terminal' ? 'terminal' : 'command'}</span>
      <span class="min-w-0 truncate font-mono text-small">{run.what}</span>
      {#if run.holder !== null}
        <span class="shrink-0 text-muted-foreground">· {run.holder}</span>
      {/if}
    </span>
  {/each}
  {#if standing.idle > 0}
    <span class="text-muted-foreground" data-standing-idle={standing.idle}
      >{standing.idle} idle {standing.idle === 1 ? 'shell' : 'shells'}</span
    >
  {/if}
</div>
