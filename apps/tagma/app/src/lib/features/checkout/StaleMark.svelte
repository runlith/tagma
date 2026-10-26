<script lang="ts">
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { note }: { note: string | null } = $props();
</script>

<Tooltip text={note ?? undefined}>
  <span class="shrink-0 leading-none text-status-stale/70" role="img" aria-label="Stale reading" data-usage-stale>·</span>
</Tooltip>
