<script lang="ts">
  import WorktreeSwatch from '$lib/features/worktrees/WorktreeSwatch.svelte';

  let { count }: { count: number } = $props();
</script>

<div class="mt-1.5 flex items-center gap-1.5 py-1 pr-2 pl-1.5 text-small text-muted-foreground" data-worktree-nowhere={count}>
  <WorktreeSwatch row={null} />
  <span class="min-w-0 flex-1 truncate">Not in a worktree</span>
  <span class="tabular text-muted-foreground/70">{count}</span>
</div>
