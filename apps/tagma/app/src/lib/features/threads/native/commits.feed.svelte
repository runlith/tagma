<script lang="ts">
  import type { CatalogOperationId } from '$lib/wire/operation.js';
  import { RootId } from '@tagma/server/workspace/contract/wire/ids';
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import CommitStep from '$lib/features/checkout/CommitStep.svelte';
  import ThreadHold from '$lib/features/workspace/ThreadHold.svelte';
  import type { ShownThread } from '../ShownThread.js';

  let { kinds, contributor, shown }: { kinds: EntryKinds; contributor: string; shown: ShownThread } = $props();

  const landed = (entry: ChatEntryOf<'tool'>) => (entry.display?.reference?.kind === 'commit' ? entry.display.reference : null);

  $effect.pre(() =>
    kinds.registerTool(contributor, {
      name: 'submit_work' satisfies CatalogOperationId,
      render: commitRow,
      renders: (entry) => shown.id !== null && landed(entry) !== null,
    }),
  );
</script>

{#snippet commitRow(entry: ChatEntryOf<'tool'>)}
  {@const reference = landed(entry)}
  {#if reference !== null && shown.id !== null}
    <ThreadHold thread={shown.id}>
      <CommitStep {entry} checkout={RootId.make(reference.checkout)} commit={reference.commit} />
    </ThreadHold>
  {/if}
{/snippet}
