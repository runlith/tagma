<script lang="ts" module>
  import type { StartEntry } from '@tagma/server/native-harness/contract/wire/start';
  import type { ProductEntry } from '@runlith/chat-ui/entries';
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import { type KindDeclaration, productKindDeclaration } from './contribution.js';
  import { startKind } from './productRecords.js';
  import StartCard from './StartCard.svelte';

  export const kinds: readonly KindDeclaration[] = [productKindDeclaration({ ...startKind, render: startRow })];
</script>

{#snippet startRow(entry: ProductEntry<StartEntry>, _view: ChatEntryContext)}
  <StartCard start={entry.payload} />
{/snippet}
