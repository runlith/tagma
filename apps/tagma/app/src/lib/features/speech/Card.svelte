<script lang="ts">
  import type { Snippet } from 'svelte';
  import Group from '$lib/features/settings/Group.svelte';

  let {
    title,
    fact,
    act,
    children,
  }: {
    title: string;
    fact?: string;
    act?: Snippet;
    children: Snippet;
  } = $props();
</script>

<Group {title} fact={fact ? said : undefined} {act}>
  {@render children()}
</Group>

{#snippet said()}
  <span>{fact}</span>
{/snippet}
