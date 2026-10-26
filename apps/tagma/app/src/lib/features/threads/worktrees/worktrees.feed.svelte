<script lang="ts">
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import type { ProductEntry } from '@runlith/chat-ui/entries';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
  import type { ShownThread } from '../ShownThread.js';
  import { ThreadPlace } from '../thread/ThreadPlace.svelte.js';
  import WorktreeMoveCard from './MoveCard.svelte';
  import WorktreePlaceCard from './PlaceCard.svelte';
  import { worktreeMoveKind, worktreePlaceKind } from './productRecords.js';
  import type { WorktreeMove } from './worktreeMove.js';
  import type { WorktreePlace } from './worktreePlace.js';

  let { shown, kinds, contributor }: { shown: ShownThread; kinds: EntryKinds; contributor: string } = $props();

  const places = Worktrees.use();

  $effect.pre(() => {
    const disposers = [
      kinds.register(contributor, { ...worktreeMoveKind, render: moveRow }),
      kinds.register(contributor, { ...worktreePlaceKind, render: placeRow }),
    ];
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
</script>

{#snippet moveRow(entry: ProductEntry<WorktreeMove>, _view: ChatEntryContext)}
  <WorktreeMoveCard move={entry.payload} {places} />
{/snippet}

{#snippet placeRow(entry: ProductEntry<WorktreePlace>, _view: ChatEntryContext)}
  <WorktreePlaceCard place={entry.payload} {places} standing={shown.lease?.get(ThreadPlace).standing ?? null} />
{/snippet}
