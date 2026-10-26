<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import SidebarHeading from '$lib/features/graph/sidebar/SidebarHeading.svelte';
  import SidebarRow from '$lib/features/graph/sidebar/SidebarRow.svelte';
  import { Sidebar } from '$lib/features/graph/sidebar/Sidebar.svelte.js';

  const sidebar = Sidebar.use();

  let {
    heading,
    blocks,
    project,
    badge,
  }: {
    heading: string;
    blocks: readonly TreeBlock[];
    project: string;
    badge?: Snippet<[TreeBlock]>;
  } = $props();
</script>

{#if blocks.length > 0}
  <section class="px-3 pt-4">
    <SidebarHeading {heading} count={blocks.length} />

    {#if sidebar.shelfOpen(heading)}
      <div class="mt-1">
        {#each blocks as block (block.name)}
          {#if badge}
            <SidebarRow {block} {project}>
              {#snippet trailing()}{@render badge(block)}{/snippet}
            </SidebarRow>
          {:else}
            <SidebarRow {block} {project} />
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}
