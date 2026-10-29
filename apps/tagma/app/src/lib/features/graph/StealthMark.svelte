<script lang="ts">
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { cn } from '$lib/shared/utils.js';

  let { displaced = false, word = false, class: className }: { displaced?: boolean; word?: boolean; class?: string } = $props();

  const told = $derived(
    displaced
      ? "Stealth: kept in Tagma's data directory, the repository never carries it. Its team parent left the team tree, so it stands under the root until that parent returns"
      : "Stealth: kept in Tagma's data directory, the repository never carries it",
  );
</script>

<Tooltip text={told}>
  {#if word}
    <span class={cn('flex items-center gap-1.5 text-muted-foreground', className)}>
      <EyeOff class="size-3.5" />
      <span class="eyebrow">Stealth</span>
    </span>
  {:else}
    <span class={cn('grid place-items-center', className)}>
      <EyeOff class="size-3 text-muted-foreground/70" />
    </span>
  {/if}
</Tooltip>
