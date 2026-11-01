<script lang="ts">
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Plus from '@lucide/svelte/icons/plus';
  import Users from '@lucide/svelte/icons/users';
  import { Platform } from '@runlith/layer/Platform';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Push } from '$lib/features/devices/Push.svelte.js';
  import { machineName } from '$lib/features/shell/machine.js';
  import { threadMark } from '$lib/features/threads/Life.svelte';
  import { ThreadList } from '$lib/features/threads/List.svelte.js';
  import Conversation from '$lib/features/threads/native/Conversation.svelte';
  import ModelPanel from '$lib/features/threads/native/ModelPanel.svelte';
  import ModelPicker from '$lib/features/threads/native/ModelPicker.svelte';
  import type { ThreadTreeNode } from '$lib/features/threads/forest.js';
  import type { ThreadSlot } from '$lib/features/threads/ThreadSlot.svelte.js';
  import { GraphRung } from '$lib/features/workspace/GraphRung.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import Header from './Header.svelte';
  import Options from './Options.svelte';
  import Sheet from './Sheet.svelte';
  import HomeHold from '$lib/features/threads/HomeHold.svelte';
  import ThreadRow from './ThreadRow.svelte';

  let { host, project }: { host: ThreadSlot; project: string } = $props();

  const list = ThreadList.use();
  const push = Push.use();
  const workspace = Workspace.use();
  const addresses = Addresses.use();
  const machine = machineName(Platform.use().storage.local);

  $effect(() => {
    if (host.activeId !== null) void push.seen(host.activeId);
  });
  const graphAim = GraphRung.Source.use();
  const graphKey = $derived.by(() => {
    const aim = graphAim();
    return aim === undefined ? null : GraphRung.keyOf(aim);
  });

  function find(nodes: readonly ThreadTreeNode[], id: string): ThreadTreeNode | null {
    for (const node of nodes) {
      if (node.row.id === id) return node;
      const below = find(node.children, id);
      if (below !== null) return below;
    }
    return null;
  }

  const node = $derived(host.activeId === null ? null : find(list.tree, host.activeId));
  const row = $derived(node?.row ?? null);
  const title = $derived(host.activeId === null ? 'New thread' : host.identity?.title.trim() || 'Untitled');
  const caption = $derived(row === null ? project : `${threadMark(row).label} · ${project}`);
  const team = $derived(node?.children ?? []);
  const parent = $derived(host.identity?.parent);
  const parentHome = $derived(parent === undefined ? undefined : workspace.find(parent.projectId)?.name);
  const back = $derived(
    parent === undefined ? addresses.thread(null, project) : parentHome === undefined ? undefined : addresses.thread(parent.id, parentHome),
  );
  const mode = $derived(host.writes.modes?.declared.find((one) => one.id === host.writes.modes?.active));
  const modeTone = $derived(mode?.elevated === true ? 'bg-destructive' : null);

  let options = $state(false);
  let mates = $state(false);

  $effect(() => {
    void host.activeId;
    options = false;
    mates = false;
  });
</script>

<svelte:head><title>{title}</title></svelte:head>

<Header {title} {caption} parent={back}>
  {#snippet actions()}
    {#if team.length > 0}
      <button
        type="button"
        class="flex h-11 items-center gap-1 rounded-full px-3 text-ui text-muted-foreground active:bg-hover"
        aria-label={`Team: ${team.length} agents`}
        onclick={() => (mates = true)}
      >
        <Users class="size-4" /><span class="tabular">{team.length}</span>
      </button>
    {/if}
  {/snippet}
</Header>

<div class="relative min-h-0 flex-1">
  {#if host.surface.terminal !== null}
    <div class="grid h-full place-items-center px-8">
      <div class="grid max-w-xs justify-items-center gap-3 text-center">
        <Monitor class="size-4 text-muted-foreground" />
        <p class="text-body text-muted-foreground">This agent runs in a terminal. Open on {machine} to work with it.</p>
        <button
          type="button"
          class="flex h-11 items-center gap-2 rounded-full bg-hover px-4 text-ui text-foreground active:bg-selected"
          onclick={() => host.surface.toggle()}
        >
          <MessageSquareText class="size-4" />Show as chat
        </button>
      </div>
    </div>
  {:else if graphKey !== null}
    {#key graphKey}
      <Conversation {host} {lead} sheets />
    {/key}
  {/if}
</div>

{#snippet lead()}
  <button
    type="button"
    class="relative grid size-8 shrink-0 place-items-center rounded-full bg-hover text-foreground active:bg-selected"
    aria-label="Photos, permissions and team"
    onclick={() => (options = true)}
  >
    <Plus class="size-4" />
    {#if modeTone !== null}
      <span class={cn('absolute top-0 right-0 size-2 rounded-full ring-2 ring-background', modeTone)}></span>
    {/if}
  </button>
  <ModelPicker views={host.views} panel={host.panel} />
{/snippet}

{#if options}
  <Options {host} onClose={() => (options = false)} />
{/if}

{#if host.panel.current !== null}
  <Sheet label="Model" onClose={() => host.panel.close()}>
    <ModelPanel
      shown={host.shown}
      chat={host.chat}
      views={host.views}
      writes={host.writes}
      panel={host.panel}
      door={{ returnFocus: () => undefined }}
      closesOutside={false}
    />
  </Sheet>
{/if}

{#if mates}
  <Sheet label="Team" title="Team" onClose={() => (mates = false)}>
    {#each team as mate (mate.row.id)}
      <HomeHold projectId={mate.row.projectId}><ThreadRow node={{ ...mate, children: [] }} {project} /></HomeHold>
    {/each}
  </Sheet>
{/if}
