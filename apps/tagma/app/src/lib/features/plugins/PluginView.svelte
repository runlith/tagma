<script lang="ts">
  import type { ToolActivityEntry } from '@runlith/chat-ui/activity';
  import { ExternalLinks } from '$lib/shared/ExternalLinks.js';
  import { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
  import { ShellOps, type ShellPort } from '$lib/features/workspace/ShellOps.js';
  import { Door } from '$lib/wire/Door.js';
  import { Live } from '$lib/wire/Live.js';
  import { SoundChannel } from '$lib/wire/SoundChannel.js';
  import ResultFrame from '../views/ResultFrame.svelte';
  import type { ViewDocument } from '../views/ViewBridge.js';
  import ViewFrame from '../views/ViewFrame.svelte';
  import { pluginHost } from './pluginHost.svelte.js';
  import { ViewSets } from './ViewSets.svelte.js';

  type Props = {
    plugin: string;
    view: string;
    projectId: number;
    threadId: string | null;
    key?: string | null;
    entry?: ToolActivityEntry;
    fill?: boolean;
    ceiling?: number | null;
    shell?: ShellPort;
  };

  let { plugin, view, projectId, threadId, key = null, entry, fill = false, ceiling = null, shell }: Props = $props();

  const appShell = ShellOps.use();
  const door = Door.use();
  const live = Live.use();
  const sound = SoundChannel.use();
  const presence = ThreadPresence.use();
  const sets = ViewSets.use();
  const links = ExternalLinks.use();
  const owners = $derived({ door, live, sound, presence, shell: shell ?? appShell, sets, links });

  const project = $derived(projectId);
  const pluginId = $derived(plugin);
  const viewId = $derived(view);
  const thread = $derived(threadId);
  const pinned = $derived(key);
  const shown = $derived(sets.view(pluginId, viewId));
  const site = $derived(shown?.set.site ?? null);
  const address = $derived(shown === undefined || site?._tag !== 'served' ? null : new URL(shown.view.entry, `${site.origin}/`).href);
  const page = $derived.by((): ViewDocument | null => (address === null ? null : { src: address, csp: {}, permissions: {} }));
  const host = $derived(pluginHost(owners, { projectId: project, plugin: pluginId, view: viewId, threadId: thread, key: pinned }));
  const mount = $derived({ host, page });
  const title = $derived(shown === undefined ? `${plugin}/${view}` : `${shown.set.title} · ${view}`);
</script>

{#if sets.problem !== null}
  <p class="text-small text-chat-failure/90">{sets.problem}</p>
{:else if site?._tag === 'unserved'}
  <p class="text-small text-muted-foreground">The view {plugin}/{view} does not open here: {site.reason}</p>
{:else if sets.known && page === null}
  <p class="text-small text-muted-foreground">The view {plugin}/{view} is not available in this project.</p>
{:else if page !== null}
  {#key mount}
    {#if entry !== undefined}
      <ResultFrame {entry} view={page} {host} {title} bordered={true} />
    {:else}
      <ViewFrame view={page} {host} {title} bordered={false} {fill} {ceiling} />
    {/if}
  {/key}
{/if}
