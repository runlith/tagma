<script lang="ts">
  import Working from '$lib/shared/ui/Working.svelte';
  import { ProjectPulse } from './Pulse.svelte.js';
  import { countOf, pulseWords } from './words.js';

  let { projectId }: { projectId: number } = $props();

  const pulse = ProjectPulse.use();
  const counts = $derived(pulse.of(projectId));
  const words = $derived(pulseWords(counts));
</script>

{#if words !== ''}
  <span class="flex shrink-0 items-center gap-1.5" title={words} data-project-pulse={projectId}>
    <span class="sr-only">{words}</span>
    {#if counts.working > 0}
      <span class="flex items-center gap-1 stamp font-semibold text-status-in-work" data-tone aria-hidden="true">
        <Working />{countOf(counts.working)}
      </span>
    {/if}
    {#if counts.awaiting > 0}<span class="size-1.75 bg-status-open" aria-hidden="true"></span>{/if}
  </span>
{/if}
