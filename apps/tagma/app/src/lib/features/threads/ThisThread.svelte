<script lang="ts">
  import LayoutList from '@lucide/svelte/icons/layout-list';
  import ListTree from '@lucide/svelte/icons/list-tree';
  import ChangesItem from '$lib/features/checkout/ChangesItem.svelte';
  import { ThreadChanges } from '$lib/features/checkout/ThreadChanges.svelte.js';
  import { onLinkOpened } from '$lib/features/opening/linkTarget.js';
  import PagesMenu from '$lib/features/pages/PagesMenu.svelte';
  import { ThreadPages } from '$lib/features/pages/ThreadPages.svelte.js';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import { buttonVariants } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import Working from '$lib/shared/ui/Working.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { AgentsColumn } from './AgentsColumn.svelte.js';
  import HomeHold from './HomeHold.svelte';
  import { ThreadList } from './List.svelte.js';
  import TeamMember from './TeamMember.svelte';
  import { crewOf } from './team.js';
  import { ThreadFolds } from './threadFolds.svelte.js';

  let { thread, here }: { thread: string; here: number } = $props();

  const changes = ThreadChanges.use();
  const pages = ThreadPages.use();
  const list = ThreadList.use();
  const column = AgentsColumn.use();
  const folds = ThreadFolds.use();

  const crew = $derived(crewOf(list.node(thread)));
  const working = $derived(crew.running.length);
  const fresh = $derived(pages.fresh.size > 0);
  const made = $derived(!changes.empty || pages.total > 0);
  const inside = $derived([
    ...(changes.empty ? [] : ['changes']),
    ...(pages.total > 0 ? ['pages'] : []),
    ...(working > 0 ? ['agents'] : []),
  ]);
  const spoken = $derived(
    ['This thread', ...(working > 0 ? [`${working} of ${crew.total} agents working`] : []), ...(fresh ? ['a new page'] : [])].join(', '),
  );

  let open = $state(false);

  function showAll(): void {
    if (!column.open) column.toggle();
    folds.setOpen(thread, true);
    if (!folds.isStubOpen(thread)) folds.toggleStub(thread);
  }
</script>

{#if inside.length > 0}
  <DropdownMenu.Root bind:open>
    <Tooltip text={`This thread: ${inside.join(', ')}`}>
      <DropdownMenu.Trigger
        class={cn(buttonVariants({ variant: 'quiet', size: working > 0 ? 'sm' : 'icon-sm' }), working > 0 && 'gap-1.5 px-1.5')}
        aria-label={spoken}
        data-this-thread={working}
        data-this-thread-fresh={fresh ? '' : undefined}
      >
        <span class="relative flex shrink-0">
          <Badge dot={fresh} tone="open" class="-top-0.5 -right-0.5"><LayoutList class="size-4" /></Badge>
        </span>
        {#if working > 0}
          <Working />
          <span class="text-small font-medium tabular-nums text-foreground">{working}</span>
        {/if}
      </DropdownMenu.Trigger>
    </Tooltip>
    <DropdownMenu.Content align="end" collisionPadding={12} class="w-80" {@attach onLinkOpened(() => (open = false))}>
      <ChangesItem />
      <PagesMenu {thread} onOpened={() => (open = false)} />
      {#if working > 0}
        {#if made}<DropdownMenu.Separator />{/if}
        <DropdownMenu.Label>Agents working</DropdownMenu.Label>
        {#each crew.running as node (node.row.id)}
          <HomeHold projectId={node.row.projectId}><TeamMember {node} {here} /></HomeHold>
        {/each}
        {#if crew.total > working}
          <DropdownMenu.Item icon={ListTree} onSelect={showAll}>Show all {crew.total} agents</DropdownMenu.Item>
        {/if}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
