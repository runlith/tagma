<script lang="ts">
  import { untrack } from 'svelte';
  import type { ShellPort } from '$lib/features/workspace/ShellOps.js';
  import type { MountFacts } from './client.svelte.js';
  import { PluginMount } from './PluginMount.svelte.js';
  import { PluginModules, type ViewComponent } from './PluginModules.js';
  import ViewFailed from './ViewFailed.svelte';
  import ViewPreparing from './ViewPreparing.svelte';

  type Props = {
    address: string;
    facts: MountFacts;
    title: string;
    props: Readonly<Record<string, unknown>>;
    shell: ShellPort | undefined;
  };

  let { address, facts, title, props, shell }: Props = $props();

  untrack(() => PluginMount.mount({ facts, shell }));
  const modules = PluginModules.use();

  let loaded = $state.raw<{ readonly component: ViewComponent } | { readonly failure: string } | null>(null);

  const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

  $effect(() => {
    const asked = address;
    let live = true;
    loaded = null;
    modules.load(asked).then(
      (component) => {
        if (live) loaded = { component };
      },
      (failure: unknown) => {
        if (live) loaded = { failure: messageOf(failure) };
      },
    );
    return () => {
      live = false;
    };
  });
</script>

{#if loaded === null}
  <ViewPreparing {title} />
{:else if 'failure' in loaded}
  <ViewFailed
    title="This view does not load"
    plugin={facts.plugin}
    view={facts.view}
    projectId={facts.projectId}
    message={loaded.failure}
  />
{:else}
  {@const View = loaded.component}
  <svelte:boundary>
    <View {...props} />
    {#snippet failed(error)}
      <ViewFailed
        title="This view stopped"
        plugin={facts.plugin}
        view={facts.view}
        projectId={facts.projectId}
        message={messageOf(error)}
      />
    {/snippet}
  </svelte:boundary>
{/if}
