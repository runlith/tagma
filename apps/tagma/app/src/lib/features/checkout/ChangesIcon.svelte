<script lang="ts">
  import FileDiff from '@lucide/svelte/icons/file-diff';
  import Badge from '$lib/shared/ui/Badge.svelte';

  let { unchecked, small = false }: { unchecked: boolean; small?: boolean } = $props();
</script>

<span class="relative flex shrink-0" aria-hidden="true" data-changes-unchecked={unchecked ? '' : undefined}>
  <Badge dot={unchecked} tone="stale" class={['-top-0.5 -right-0.5', small && 'size-1']}>
    <FileDiff class={small ? 'size-3' : 'size-3.5'} />
  </Badge>
</span>
