<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import { refusalLines } from '@runlith/agent/tool/refusal';
  import PointView from '@runlith/layer/svelte/PointView.svelte';
  import TypeFields from '$lib/features/graph/block/TypeFields.svelte';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import { BlockSections } from './sections.js';

  let { read }: { read: BlockRead } = $props();

  const tags = TagCatalog.use();
  const sections = BlockSections.use();

  const facts = $derived(tags.factsOf(read));
  const delivery = $derived(read.reach === null ? null : tags.deliveryOf(read, read.sources.length > 0));
  const unheard = $derived(read.reach !== null && tags.reachesNobody(read, read.sources.length > 0));
  const everywhere = $derived(read.sources.some((one) => one.ref.replace(/\/+$/, '') === '.'));
</script>

<TypeFields {read} />

{#if delivery !== null}
  <div class="mt-5 flex items-baseline gap-4 text-ui">
    <span class="eyebrow shrink-0 text-muted-foreground">Delivery</span>
    <span class="text-foreground/90">
      {#if delivery === 'prompt'}
        In every agent’s instructions
      {:else if delivery === 'finding'}
        {unheard
          ? 'With its check’s results — its check runs on nothing, so no agent gets it'
          : 'With its check’s results — no agent gets it in advance'}
      {:else if read.sources.length === 0}
        With the code its sources name — it has none yet, so no agent gets it
      {:else if everywhere}
        When an agent reads or writes any code in the repository
      {:else}
        When an agent reads or writes the code its sources name
      {/if}
    </span>
  </div>
{/if}

{#each read.unreachable ?? [] as copy}
  <div class="mt-2 text-meta text-muted-foreground">
    <p>Project {copy.projectId}</p>
    {#each refusalLines(copy.error) as line}<p>{line}</p>{/each}
  </div>
{/each}

{#each read.copyFailures ?? [] as failure}
  <div class="mt-2 text-meta text-muted-foreground">
    <p>Graph copy {failure.copy.tree} · checkout {failure.copy.checkout}</p>
    {#each refusalLines(failure.error) as line}<p>{line}</p>{/each}
  </div>
{/each}

{#if facts}
  <dl class="mt-5 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-ui">
    <dt class="eyebrow text-muted-foreground">Command</dt>
    <dd><code class="text-ui">{facts.command}</code></dd>
    <dt class="eyebrow text-muted-foreground">Expected</dt>
    <dd>{facts.expected}</dd>
    <dt class="eyebrow text-muted-foreground">Actual</dt>
    <dd>{facts.actual}</dd>
  </dl>
{/if}

{#key read.identity}
  <PointView point={sections} props={{ read }} />
{/key}
