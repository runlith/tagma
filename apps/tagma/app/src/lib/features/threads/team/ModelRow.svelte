<script lang="ts">
  import type { TeamModelKey } from '@runlith/agent/collaboration/team';
  import Check from '@lucide/svelte/icons/check';
  import RowLabel from './RowLabel.svelte';
  import Usage from './Usage.svelte';

  let {
    row,
    checked,
    quota = false,
    disabled = false,
    onclick,
  }: { row: TeamModelKey; checked: boolean; quota?: boolean; disabled?: boolean; onclick: () => void } = $props();
</script>

<button
  type="button"
  role="checkbox"
  aria-checked={checked}
  class="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui transition-colors hover:bg-hover disabled:opacity-60"
  {disabled}
  {onclick}
  data-team-row={`${row.provider}/${row.model}${row.reasoning === null ? '' : ` ${row.reasoning}`}`}
>
  <Check class={['size-3.5 shrink-0', !checked && 'invisible']} />
  <span class={['flex min-w-0 flex-1 items-center gap-2', !checked && 'opacity-45']}>
    {#if quota}<Usage provider={row.provider} part="gauge" />{/if}
    <RowLabel {row} named={quota} />
  </span>
  {#if quota}<Usage provider={row.provider} part="percent" />{/if}
</button>
