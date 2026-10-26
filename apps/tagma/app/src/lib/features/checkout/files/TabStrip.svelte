<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import Pin from '@lucide/svelte/icons/pin';
  import PinOff from '@lucide/svelte/icons/pin-off';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import FadeText from '$lib/shared/FadeText.svelte';
  import FileIcon from '$lib/shared/FileIcon.svelte';
  import TabRail from '$lib/shared/TabRail.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
  import { Documents } from './Documents.svelte.js';
  import { Tabs } from './Tabs.svelte.js';
  import type { Tab } from './tab.js';

  const tabs = Tabs.use();
  const documents = Documents.use();
  const door = GraphDoor.use();

  const nameOf = (tab: Tab): string => tab.path.slice(tab.path.lastIndexOf('/') + 1);

  const titleOf = (tab: Tab): string =>
    `${tab.path}${tab.branch === null ? '' : ` · ${tab.branch}`}${tab.kind === 'preview' ? ' · preview' : tab.kind === 'diff' ? ' · changes' : tab.kind === 'compare' ? ' · disk ↔ buffer' : ''}${tabs.goneFile(tab) ? ' · deleted' : ''}`;

  function markOf(tab: Tab): 'pending' | 'refused' | null {
    return tab.kind === 'file' ? documents.mark({ projectId: door.aim.projectId, rootId: tab.rootId }, tab.path) : null;
  }
</script>

{#snippet face(tab: Tab)}
  {@const mark = markOf(tab)}
  {#if tab.state === 'pinned'}
    <Pin class="size-3 shrink-0 text-muted-foreground" />
  {:else if tab.kind === 'diff'}
    <GitCompare class="size-3.5 shrink-0 text-muted-foreground" />
  {:else}
    <FileIcon path={tab.path} />
  {/if}
  <span class="flex min-w-0 flex-1 items-center gap-1.5">
    <FadeText
      class={cn('min-w-0', tab.state === 'preview' && 'italic', (tabs.orphaned(tab) || tabs.goneFile(tab)) && 'line-through')}
      text={nameOf(tab)}
      data-tab-state={tab.state}
    />
    {#if tab.branch !== null}
      <FadeText class="max-w-24 min-w-0 shrink rounded-sm bg-hover px-1 text-meta text-muted-foreground" text={tab.branch} />
    {/if}
  </span>
  {#if mark !== null}
    <span
      class={cn('size-1.5 shrink-0', mark === 'refused' ? 'bg-destructive' : 'bg-foreground/60')}
      title={mark === 'refused' ? 'Not saved' : 'Unsaved changes'}
      data-tab-unsaved={mark}
    ></span>
  {/if}
{/snippet}

{#snippet pinning(tab: Tab)}
  <DropdownMenu.Item icon={tab.state === 'pinned' ? PinOff : Pin} onSelect={() => tabs.pin(tab.id, tab.state !== 'pinned')}>
    {tab.state === 'pinned' ? 'Unpin' : 'Pin'}
  </DropdownMenu.Item>
{/snippet}

{#snippet copying(tab: Tab)}
  <DropdownMenu.Item icon={Copy} onSelect={() => void navigator.clipboard.writeText(tab.path)}>Copy path</DropdownMenu.Item>
{/snippet}

<TabRail
  class="relative h-8 shrink-0 border-b bg-chrome px-1"
  items={tabs.tabs}
  key={(tab) => tab.id}
  active={tabs.activeId}
  label="Open files"
  name={nameOf}
  title={titleOf}
  activate={(id) => tabs.activate(id)}
  close={(id) => tabs.close(id)}
  move={(id, before) => tabs.move(id, before)}
  keep={(id) => tabs.keep(id)}
  closeOthers={(id) => tabs.closeOthers(id)}
  closeRight={(id) => tabs.closeRight(id)}
  closeAll={() => tabs.closeAll()}
  tab={face}
  acts={pinning}
  copies={copying}
/>
