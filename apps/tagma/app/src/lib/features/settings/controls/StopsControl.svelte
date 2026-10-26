<script lang="ts">
  import { stepRadio } from '$lib/features/settings/controls/radiogroup.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    label,
    stops,
    value,
    fallback,
    disabled = false,
    onwrite,
  }: {
    label: string;
    stops: readonly number[];
    value: unknown;
    fallback: unknown;
    disabled?: boolean;
    onwrite: (value: number) => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<div role="radiogroup" aria-label={label} tabindex={-1} class="flex shrink-0 overflow-hidden rounded-lg border" onkeydown={stepRadio}>
  {#each stops as stop, index (stop)}
    {@const here = Number(value) === stop}
    <Tooltip text={Number(fallback) === stop ? 'Tagma default' : undefined}>
      <button
        type="button"
        role="radio"
        aria-checked={here}
        tabindex={here ? 0 : -1}
        class="relative w-8 py-1 text-center font-mono text-small transition-colors disabled:opacity-50 {here
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-hover'}"
        class:border-l={index > 0}
        {disabled}
        onclick={() => onwrite(stop)}
      >
        {stop}
        {#if Number(fallback) === stop}
          <span class="absolute inset-x-1.5 bottom-0.5 h-px bg-brand"></span>
        {/if}
      </button>
    </Tooltip>
  {/each}
</div>
