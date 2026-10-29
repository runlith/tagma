<script lang="ts">
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import type { BlockRefs } from '$lib/features/graph/blockRefView.js';
  import MarkdownBody from '$lib/features/graph/MarkdownBody.svelte';
  import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
  import type { PathRoad } from '$lib/features/opening/PathLinks.js';
  import type { TranslationLens } from './Lens.svelte.js';

  let { lens, original, paths }: { lens: TranslationLens; original: string; paths: PathRoad | undefined } = $props();

  const titles = BlockTitles.use();
  const commits = CommitLinks.use();

  const lang = $derived(lens.language() ?? undefined);
  const stopped = $derived(lens.projection?.state === 'stopped' || lens.projection?.state === 'failed');

  const refs: BlockRefs = {
    peer: (name) => {
      const peer = titles.peer(name);
      const title = lens.titleOf(name);
      return title === undefined || peer == null || 'error' in peer ? peer : { ...peer, title };
    },
    open: (name, aim) => titles.open(name, aim),
  };
</script>

<div class="mt-4 grid gap-3">
  {#if lens.projection === null}
    <MarkdownBody text={original} refs={titles} {commits} {paths} />
  {:else}
    {#each lens.segments as segment (segment.key)}
      {#if segment.kind === 'changed'}
        <div class="border-l-2 border-status-stale/65 pl-3">
          <span class="block text-meta text-status-stale">{stopped ? 'Not translated yet' : 'Changed since the translation'}</span>
          <MarkdownBody text={segment.text} refs={titles} {commits} {paths} {lang} />
        </div>
      {:else if segment.kind === 'pending'}
        <div class="opacity-40">
          <MarkdownBody text={segment.text} refs={titles} {commits} {paths} {lang} />
        </div>
      {:else}
        <div {lang}>
          <MarkdownBody text={segment.text} {refs} {commits} {paths} {lang} />
        </div>
      {/if}
    {/each}
  {/if}
</div>
