<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { tick } from 'svelte';
  import SidebarHeading from '$lib/features/graph/sidebar/SidebarHeading.svelte';
  import SidebarRow from '$lib/features/graph/sidebar/SidebarRow.svelte';
  import { Sidebar } from '$lib/features/graph/sidebar/Sidebar.svelte.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { cn } from '$lib/shared/utils.js';
  import { SidebarTree } from './SidebarTree.svelte.js';
  import { treeStep } from './treeLines.js';

  let { project }: { project: string } = $props();

  const HEADING = 'Tree';

  const sidebar = Sidebar.use();
  const addresses = Addresses.use();
  const tree = SidebarTree.mount();

  const current = $derived(addresses.scope);
  let focused = $state<string | null>(null);
  let list = $state<HTMLElement | null>(null);

  const tabStop = $derived.by(() => {
    const lines = tree.lines;
    for (const wanted of [focused, current]) {
      if (wanted !== null && lines.some((line) => line.name === wanted)) return wanted;
    }
    return lines[0]?.name ?? null;
  });

  const topLevel = $derived(tree.lines.filter((line) => line.depth === 1).length);

  async function onKeydown(event: KeyboardEvent): Promise<void> {
    const step = treeStep(tree.lines, tabStop, event.key, tree.expanded);
    if (step === null) return;
    event.preventDefault();
    if (step.kind === 'expand') tree.expand(step.name);
    else if (step.kind === 'collapse') tree.collapse(step.name);
    else {
      focused = step.name;
      await tick();
      list?.querySelector<HTMLElement>(`[data-tree-name="${step.name}"]`)?.focus();
    }
  }
</script>

{#if tree.lines.length > 0}
  <section class="px-3 pt-4">
    <SidebarHeading heading={HEADING} count={topLevel} />

    {#if sidebar.shelfOpen(HEADING)}
      <div bind:this={list} class="mt-1" role="tree" aria-label="Project blocks" tabindex="-1" onkeydown={onKeydown}>
        {#each tree.lines as line (line.name)}
          {@const block = tree.block(line.name)}
          {@const open = tree.expanded.has(line.name)}
          {#if block}
            <div style:padding-left="calc(var(--spacing) * {(line.depth - 1) * 3})" onfocusin={() => (focused = line.name)}>
              <SidebarRow
                {block}
                {project}
                attributes={{
                  role: 'treeitem',
                  'aria-level': line.depth,
                  'aria-expanded': line.branch ? open : undefined,
                  'aria-selected': line.name === current,
                  tabindex: line.name === tabStop ? 0 : -1,
                  'data-tree-name': line.name,
                }}
                class={cn(line.name === current && 'bg-selected')}
              >
                {#snippet leading()}
                  {#if line.branch}
                    <button
                      type="button"
                      tabindex="-1"
                      class="relative mr-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={open ? `Collapse ${line.name}` : `Expand ${line.name}`}
                      onclick={() => tree.toggle(line.name)}
                    >
                      <ChevronRight class={cn('size-3 transition-transform duration-150 ease-instrument', open && 'rotate-90')} />
                    </button>
                  {:else}
                    <span class="mr-0.5 size-4 shrink-0"></span>
                  {/if}
                {/snippet}
              </SidebarRow>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
{/if}
