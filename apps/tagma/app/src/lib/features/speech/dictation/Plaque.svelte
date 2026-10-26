<script lang="ts">
  import { Dictation } from './Dictation.svelte.js';
  import Meter from './Meter.svelte';
  import type { Target } from './target.js';

  let { target }: { target: Target } = $props();

  const dictation = Dictation.use();
</script>

{#if dictation.target === target}
  <div
    class="absolute inset-x-3 bottom-3 z-20 flex items-start gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-float"
    role="status"
    aria-live="polite"
  >
    <span class="flex shrink-0 items-center gap-1.5 pt-0.5"><Meter /></span>
    <p class="min-w-0 flex-1 text-ui break-words">
      {#if dictation.stable === '' && dictation.guess === ''}
        <span class="text-muted-foreground">Speak — the phrase is typed here when you release, without Enter</span>
      {:else}
        {dictation.stable}<span class="text-muted-foreground">{dictation.guess}</span>
      {/if}
    </p>
  </div>
{/if}
