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

  type Outcome = { readonly component: ViewComponent } | { readonly failure: string };

  let arrived = $state.raw<{ readonly address: string; readonly outcome: Outcome } | null>(null);

  const loaded = $derived.by((): Outcome | null => {
    const settled = modules.loaded(address);
    if (settled !== undefined) return { component: settled };
    return arrived?.address === address ? arrived.outcome : null;
  });

  const messageOf = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

  $effect(() => {
    const asked = address;
    if (modules.loaded(asked) !== undefined) return;
    let live = true;
    modules.load(asked).then(
      (component) => {
        if (live) arrived = { address: asked, outcome: { component } };
      },
      (failure: unknown) => {
        if (live) arrived = { address: asked, outcome: { failure: messageOf(failure) } };
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
