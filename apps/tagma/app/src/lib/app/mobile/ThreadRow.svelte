<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ThreadLife from '$lib/features/threads/Life.svelte';
  import ContextRing from '$lib/features/threads/native/ContextRing.svelte';
  import ModelPlate from '$lib/features/threads/native/ModelPlate.svelte';
  import { CallActivity } from '$lib/features/threads/CallActivity.svelte.js';
  import { RowReading } from '$lib/features/threads/rowReading.svelte.js';
  import { WorkLines } from '$lib/features/threads/workLines.svelte.js';
  import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
  import AgentCounts from '$lib/shared/ui/AgentCounts.svelte';
  import type { ThreadTreeNode } from '$lib/features/threads/forest.js';
  import { stands } from '$lib/features/threads/tree.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import ProjectMark from '$lib/features/workspace/ProjectMark.svelte';
  import { cn } from '$lib/shared/utils.js';
  import type { Snippet } from 'svelte';
  import Self from './ThreadRow.svelte';

  let { node, project, depth = 0, frame }: { node: ThreadTreeNode; project: string; depth?: number; frame?: Snippet<[Snippet]> } = $props();

  const reading = new RowReading(() => node, WallClock.use(), WorkLines.use(), ProviderCatalog.use(), CallActivity.use());
  const workspace = Workspace.use();
  const addresses = Addresses.use();

  const row = $derived(node.row);
  const home = $derived(workspace.find(row.projectId));
  const elsewhere = $derived(home !== null && home.name !== project);
  const root = $derived(row.parentThreadId === null);
  const title = $derived(root ? row.title.trim() || 'Untitled' : (row.name ?? row.agentId));
  const hasChildren = $derived(node.children.length > 0);
  let opened = $state<boolean | null>(null);
  const open = $derived(opened ?? node.children.some(stands));
  const detail = $derived(reading.own ?? (hasChildren && !open ? reading.team : null));
</script>

{#snippet body()}
  <div class="flex items-stretch active:bg-hover" style:padding-left={depth === 0 ? undefined : `${depth}rem`}>
    <a
      href={home === null ? undefined : addresses.thread(row.id, home.name)}
      class="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4"
      data-thread={row.id}
    >
      <ThreadLife thread={row} class="mt-1" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-baseline gap-2">
          <span class={cn('min-w-0 flex-1 truncate text-body', reading.mark.state === 'unread' && 'font-semibold')}>{title}</span>
          {#if elsewhere}<ProjectMark projectId={row.projectId} class="max-w-24 min-w-0 shrink-0" />{/if}
          <span class={cn('shrink-0 tabular text-small', reading.timeTone)}>{reading.time}</span>
        </span>
        {#if detail !== null}
          <span class={cn('flex min-w-0 items-center gap-2 text-ui', detail.tone)}>
            <span class="min-w-0 truncate">{detail.text}</span>
            {#if detail.elapsed !== null}<span class="ml-auto shrink-0 tabular text-small">{detail.elapsed}</span>{/if}
          </span>
        {:else if reading.said !== null}
          <span class="min-w-0 truncate text-ui text-muted-foreground">{reading.said}</span>
        {/if}
        <span class="flex min-w-0 items-center gap-2 pt-0.5 text-small text-muted-foreground">
          <ModelPlate {row} />
          {#if row.contextShare !== null}
            <ContextRing
              share={row.contextShare}
              compacting={row.phase?.phase === 'compacting'}
              warmth={row.cacheWarmth}
              provider={row.provider}
            />
          {/if}
          {#if hasChildren && !open}<AgentCounts waiting={node.team.asking} failed={node.team.failed} working={node.team.working} />{/if}
        </span>
      </span>
    </a>
    {#if hasChildren}
      <button
        type="button"
        class="grid w-11 shrink-0 place-items-center text-muted-foreground"
        aria-label={open ? 'Hide agents' : `Show ${node.children.length} agents`}
        aria-expanded={open}
        onclick={() => (opened = !open)}
      >
        <ChevronRight class={['size-4 transition-transform', open && 'rotate-90']} />
      </button>
    {:else}
      <span class="w-4 shrink-0"></span>
    {/if}
  </div>
{/snippet}

{#if frame}{@render frame(body)}{:else}{@render body()}{/if}
{#if open}
  {#each node.children as child (child.row.id)}
    <Self node={child} {project} depth={depth + 1} />
  {/each}
{/if}
