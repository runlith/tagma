<script lang="ts">
  import FileText from '@lucide/svelte/icons/file-text';
  import StagedChip from '$lib/shared/threads/StagedChip.svelte';
  import { StagedKinds } from '$lib/shared/threads/staged.js';
  import type { ThreadDraft } from '../Draft.svelte.js';

  let { draft }: { draft: ThreadDraft } = $props();

  const kinds = StagedKinds.use();
  const items = $derived(
    draft.items.flatMap((item) => {
      const kind = kinds.find(item.kind);
      return kind === undefined ? [] : [{ item, Card: kind.card }];
    }),
  );
</script>

{#if items.length > 0 || draft.documents.length > 0}
  <div class="flex flex-wrap gap-1.5 pb-1">
    {#each items as { item, Card } (`${item.kind}/${item.key}`)}
      <Card {item} remove={() => draft.unstage(item)} />
    {/each}
    {#each draft.documents as document (document.id)}
      <StagedChip
        icon={FileText}
        title={document.title}
        hint="Remove the document"
        label="Remove document"
        onRemove={() => draft.removeDocument(document.id)}
      />
    {/each}
  </div>
{/if}
