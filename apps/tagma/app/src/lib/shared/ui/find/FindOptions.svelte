<script lang="ts">
  import CaseSensitive from '@lucide/svelte/icons/case-sensitive';
  import Regex from '@lucide/svelte/icons/regex';
  import WholeWord from '@lucide/svelte/icons/whole-word';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    caseSensitive = $bindable(),
    wholeWord = $bindable(),
    regexp = $bindable(),
  }: { caseSensitive?: boolean; wholeWord?: boolean; regexp?: boolean } = $props();

  const TOGGLE =
    'grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-selected aria-pressed:text-foreground';

  const keep = (event: MouseEvent): void => event.preventDefault();
</script>

{#if caseSensitive !== undefined}
  <Tooltip text="Match case">
    <button
      type="button"
      class={TOGGLE}
      aria-pressed={caseSensitive}
      aria-label="Match case"
      data-find-option="case"
      onmousedown={keep}
      onclick={() => (caseSensitive = !caseSensitive)}
    >
      <CaseSensitive class="size-3.5" />
    </button>
  </Tooltip>
{/if}
{#if wholeWord !== undefined}
  <Tooltip text="Match whole word">
    <button
      type="button"
      class={TOGGLE}
      aria-pressed={wholeWord}
      aria-label="Match whole word"
      data-find-option="word"
      onmousedown={keep}
      onclick={() => (wholeWord = !wholeWord)}
    >
      <WholeWord class="size-3.5" />
    </button>
  </Tooltip>
{/if}
{#if regexp !== undefined}
  <Tooltip text="Use regular expression">
    <button
      type="button"
      class={TOGGLE}
      aria-pressed={regexp}
      aria-label="Use regular expression"
      data-find-option="regexp"
      onmousedown={keep}
      onclick={() => (regexp = !regexp)}
    >
      <Regex class="size-3.5" />
    </button>
  </Tooltip>
{/if}
