<script lang="ts">
  import { PAGE_OPERATIONS } from '@tagma/server/browser/contract/wire/pageOperations';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import ToolCard, { canRender } from '../../browser/ToolCard.svelte';

  let { kinds, contributor }: { kinds: EntryKinds; contributor: string } = $props();

  $effect.pre(() => {
    const releases = Object.keys(PAGE_OPERATIONS).map((name) =>
      kinds.registerTool(contributor, { name, render: pageRow, renders: canRender }),
    );
    return () => {
      for (const release of releases) release();
    };
  });
</script>

{#snippet pageRow(entry: ChatEntryOf<'tool'>)}
  <ToolCard {entry} />
{/snippet}
