<script lang="ts">
  import { Addresses } from '$lib/features/workspace/Addresses.js';
  import Waiting from '@runlith/chat-ui/Waiting.svelte';
  import AbsentBlock from '$lib/features/graph/AbsentBlock.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { GraphFeed } from '$lib/features/graph/Feed.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { Subject } from '$lib/features/graph/block/Subject.svelte.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import TrashedBlock from '$lib/features/graph/TrashedBlock.svelte';
  import UnreadableBlock from '$lib/features/graph/UnreadableBlock.svelte';
  import GraphView from '$lib/features/graph/spatial/GraphView.svelte';
  import ScopeChip from '$lib/features/graph/ScopeChip.svelte';
  import { GraphSelection } from '$lib/features/graph/GraphSelection.svelte.js';
  import { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';

  const addresses = Addresses.use();
  const blocks = BlocksRepo.use();
  const store = TreeScreen.mount({ reading: 'graph', root: addresses.scope ?? undefined });
  const selection = GraphSelection.use();
  const subject = new Subject(store, blocks, GraphFeed.use(), TagCatalog.use(), Notices.use());

  $effect(() => () => {
    selection.name = null;
  });

  const scope = $derived(addresses.scope);

  $effect(() => {
    store.load(scope ?? undefined);
  });
</script>

<div class="relative h-full">
  {#if scope !== null && subject.unavailable?.kind === 'trashed'}
    <TrashedBlock name={scope} {store} restored={() => subject.retry()} />
  {:else if scope !== null && subject.unavailable?.kind === 'absent'}
    <AbsentBlock name={scope} />
  {:else if scope !== null && subject.unavailable?.kind === 'failed'}
    <UnreadableBlock error={subject.unavailable.error} retry={() => subject.retry()} />
  {:else if scope !== null && subject.read === null}
    <div class="grid h-full place-items-center"><Waiting class="size-4" /></div>
  {:else if store.rootAbsent && scope !== null}
    <AbsentBlock name={scope} />
  {:else}
    <GraphView {store} />
    {#if scope !== null}
      <ScopeChip name={scope} block={store.root} surface="graph" class="absolute top-4 left-4 z-10" />
    {/if}
  {/if}
</div>
