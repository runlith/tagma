<script lang="ts">
  import type { BlockAnswer, GraphCopy } from '@tagma/server/graph/contract/wire/answers';
  import type { CallJournalRange } from '@tagma/server/graph/contract/wire/callRange';
  import Well from '@runlith/chat-ui/entries/Well.svelte';
  import { diffParam } from '$lib/features/workspace/address.js';
  import BlockDiffCard from '$lib/features/graph/BlockDiffCard.svelte';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
  import DiffBox from '$lib/features/graph/DiffBox.svelte';
  import { lensOf, placedLens } from '$lib/features/graph/blockRefView.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import BlockCard from '../BlockCard.svelte';

  let { id, block, range, place }: { id: string; block: BlockAnswer; range: CallJournalRange; place?: GraphCopy } = $props();

  const blocks = BlocksRepo.use();
  const titles = BlockTitles.use();
  const workspace = Workspace.use();
  const there = $derived(
    (place === undefined ? null : placedLens(place, workspace.find(place.projectId))) ?? lensOf(titles.peer(block.name)),
  );
  const lens = $derived(
    there === null ? undefined : blocks.diff.key({ name: block.name, from: range.from, to: range.to, lens: there }).data,
  );
  const diff = $derived(lens !== undefined && !lens.diff.ops.includes('create') ? diffParam(range) : undefined);
</script>

<div class="grid min-w-0 gap-1.5">
  <Well {id} copy={null} rows>
    <BlockCard {block} {diff} {place} />
  </Well>
  {#if lens && there}
    <DiffBox class="rounded-lg bg-sunken">
      <BlockDiffCard diff={lens.diff} marks={lens.marks} blocks={lens.blocks} {there} />
    </DiffBox>
  {/if}
</div>
