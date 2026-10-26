<script lang="ts" module>
  import type { TransportEntry } from '@tagma/server/threads/contract/wire/harness/transportEntry';
  import type { ProductEntry } from '@runlith/chat-ui/entries';
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import { type KindDeclaration, productKindDeclaration } from '../native/contribution.js';
  import { transportSwitchKind } from './productRecords.js';
  import TransportRecord from './TransportRecord.svelte';

  export const kinds: readonly KindDeclaration[] = [productKindDeclaration({ ...transportSwitchKind, render: transportRow })];
</script>

{#snippet transportRow(entry: ProductEntry<TransportEntry>, _view: ChatEntryContext)}
  <TransportRecord entry={entry.payload} />
{/snippet}
