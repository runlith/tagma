<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { Component } from 'svelte';
  import FadeText from '$lib/shared/FadeText.svelte';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let {
    icon: Icon,
    title,
    count = null,
    hint,
    label,
    onRemove,
  }: {
    icon: Component<{ class?: string }>;
    title: string;
    count?: number | null;
    hint: string;
    label: string;
    onRemove: () => void;
  } = $props();
</script>

<span class="flex min-w-0 max-w-72 items-center gap-1.5 rounded-lg border bg-raised py-1 pr-1 pl-2 text-small">
  <Icon class="size-3.5 shrink-0 text-muted-foreground" />
  <FadeText text={title} />
  {#if count !== null}<span class="shrink-0 tabular-nums text-muted-foreground">{count}</span>{/if}
  <Tooltip text={hint}>
    <button
      type="button"
      class="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
      aria-label={label}
      onclick={onRemove}
    >
      <X class="size-3" />
    </button>
  </Tooltip>
</span>
