<script lang="ts">
  import type { ShellPort } from '$lib/features/workspace/ShellOps.js';
  import MountedView from './MountedView.svelte';
  import ViewFailed from './ViewFailed.svelte';
  import ViewPreparing from './ViewPreparing.svelte';
  import { ViewSets } from './ViewSets.svelte.js';

  type Props = {
    plugin: string;
    view: string;
    projectId: number;
    threadId: string | null;
    key?: string | null;
    props?: Readonly<Record<string, unknown>>;
    fill?: boolean;
    ceiling?: number | null;
    shell?: ShellPort;
  };

  let { plugin, view, projectId, threadId, key = null, props = {}, fill = false, ceiling = null, shell }: Props = $props();

  const sets = ViewSets.use();
  const shown = $derived(sets.view(plugin, view));
  const title = $derived(shown?.set.title ?? plugin);
  const built = $derived(shown?.view.module);
  const facts = $derived({ projectId, plugin, view, threadId, key });
</script>

{#if sets.problem !== null}
  <p class="text-small text-chat-failure/90">{sets.problem}</p>
{:else if built?.state === 'ready'}
  <div
    class={[fill && 'h-full min-h-0', ceiling !== null && 'overflow-auto']}
    style:max-height={ceiling === null ? undefined : `${ceiling}px`}
  >
    {#key `${built.address}\n${JSON.stringify(facts)}`}
      <MountedView address={built.address} {facts} {title} {props} {shell} />
    {/key}
  </div>
{:else if built?.state === 'failed'}
  <ViewFailed
    title="This view does not compile"
    {plugin}
    {view}
    {projectId}
    message={built.file === null ? built.message : `${built.file}: ${built.message}`}
  />
{:else if built?.state === 'preparing'}
  <ViewPreparing {title} />
{:else if sets.known}
  <p class="text-small text-muted-foreground">The view {plugin}/{view} is not available in this project.</p>
{/if}
