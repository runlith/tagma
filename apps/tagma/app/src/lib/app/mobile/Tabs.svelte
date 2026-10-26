<script module lang="ts">
  export type Tab = 'inbox' | 'threads' | 'pages' | 'settings';
</script>

<script lang="ts">
  import Globe from '@lucide/svelte/icons/globe';
  import Inbox from '@lucide/svelte/icons/inbox';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import Settings from '@lucide/svelte/icons/settings';
  import type { Component } from 'svelte';
  import { Router } from '@runlith/layer/Router';
  import { settingsHref } from '$lib/features/workspace/address.js';
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import Badge from '$lib/shared/ui/Badge.svelte';
  import { cn } from '$lib/shared/utils.js';
  import { Attention } from '../attention/Attention.svelte.js';

  let { on }: { on: Tab } = $props();

  const attention = Attention.use();
  const workspace = Workspace.use();
  const router = Router.use();
  const addresses = Addresses.use();

  const needs = $derived(attention.counts.awaiting + attention.counts.failed);
  const project = $derived(workspace.contextProject?.name ?? null);

  const tabs = $derived<readonly { id: Tab; label: string; href: string | null; icon: Component; badge: number }[]>([
    { id: 'inbox', label: 'Inbox', href: '/', icon: Inbox, badge: needs },
    { id: 'threads', label: 'Threads', href: project === null ? null : addresses.thread(null, project), icon: MessagesSquare, badge: 0 },
    { id: 'pages', label: 'Pages', href: project === null ? null : `/${encodeURIComponent(project)}/w`, icon: Globe, badge: 0 },
    { id: 'settings', label: 'Settings', href: settingsHref(router), icon: Settings, badge: 0 },
  ]);
</script>

<nav class="grid shrink-0 grid-cols-4 border-t bg-chrome pt-1" aria-label="Sections">
  {#each tabs as tab (tab.id)}
    <a
      href={tab.href ?? undefined}
      aria-current={tab.id === on ? 'page' : undefined}
      aria-disabled={tab.href === null ? 'true' : undefined}
      class={cn(
        'relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-meta font-medium',
        tab.id === on ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span class="relative">
        <Badge count={tab.badge} tone={attention.counts.failed > 0 ? 'failed' : 'open'} class="-top-1.5 left-3"
          ><tab.icon class="size-4" /></Badge
        >
      </span>
      {tab.label}
    </a>
  {/each}
</nav>
