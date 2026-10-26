<script lang="ts">
  import type { Gap, Said } from './check.js';

  let { said, gaps }: { said: readonly Said[]; gaps: readonly Gap[] } = $props();
</script>

{#if said.length > 0}
  <ul class="grid gap-1.5 border-t border-vein py-3" aria-label="Recognized speech">
    {#each said as line (line.key)}
      <li class="flex gap-2 text-ui" data-said={line.closed ? 'final' : 'partial'}>
        <span class="w-14 shrink-0 text-small text-muted-foreground">
          {line.track}{line.speaker === null ? '' : ` · ${line.speaker}`}
        </span>
        <span class={line.closed ? 'text-foreground' : 'text-muted-foreground'}>
          {line.text}{#if line.hypothesis !== ''}<span class="text-muted-foreground/70">{line.hypothesis}</span>{/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}

{#if gaps.length > 0}
  <ul class="grid gap-1 border-t border-vein py-3" aria-label="Gaps">
    {#each gaps as gap, index (index)}
      <li class="text-small text-muted-foreground">
        <span class="font-medium">{gap.track} · {gap.cause}</span> — {gap.message}
      </li>
    {/each}
  </ul>
{/if}
