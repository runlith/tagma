<script lang="ts">
  import { cn } from '$lib/shared/utils.js';
  import type { Told } from '$lib/wire/told.js';

  let { told, class: className }: { told: Told; class?: string } = $props();
</script>

<div class={cn('grid min-w-0 gap-0.5 select-text', className)} data-told-details>
  {#each told.details as line, index (index)}
    <p class="text-small wrap-anywhere text-foreground/70">{line}</p>
  {/each}
  {#if told.code !== undefined}
    <p class="stamp wrap-anywhere text-muted-foreground">{told.code}</p>
  {/if}
</div>
