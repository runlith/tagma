<script lang="ts">
  import type { CallJournalRange } from '@tagma/server/graph/contract/wire/callRange';
  import BlockDiffCard from '$lib/features/graph/BlockDiffCard.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import DiffBox from '$lib/features/graph/DiffBox.svelte';
  import { lensOf } from '$lib/features/graph/blockRefView.js';

  let { name, range }: { name: string; range: CallJournalRange } = $props();

  const blocks = BlocksRepo.use();
  const titles = BlockTitles.use();
  const there = $derived(lensOf(titles.peer(name)));
  const lens = $derived(there === null ? undefined : blocks.diff.key({ name, from: range.from, to: range.to, lens: there }).data);
</script>

{#if lens && there}
  <DiffBox class="rounded-lg border border-border/60 bg-background/60">
    <BlockDiffCard diff={lens.diff} marks={lens.marks} blocks={lens.blocks} {there} />
  </DiffBox>
{/if}
