<script lang="ts" module>
  import type { PickEntry } from '@tagma/server/threads/contract/wire/harness/pick';
  import type { TransportEntry } from '@tagma/server/threads/contract/wire/harness/transportEntry';
  import type { ProductEntry } from '@runlith/chat-ui/entries';
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import { type KindDeclaration, productKindDeclaration } from '../native/contribution.js';
  import { pickKind, transportSwitchKind } from './productRecords.js';
  import PickRecord from './PickRecord.svelte';
  import TransportRecord from './TransportRecord.svelte';

  export const kinds: readonly KindDeclaration[] = [
    productKindDeclaration({ ...transportSwitchKind, render: transportRow }),
    productKindDeclaration({ ...pickKind, render: pickRow }),
  ];
</script>

{#snippet transportRow(entry: ProductEntry<TransportEntry>, _view: ChatEntryContext)}
  <TransportRecord entry={entry.payload} />
{/snippet}

{#snippet pickRow(entry: ProductEntry<PickEntry>, _view: ChatEntryContext)}
  <PickRecord entry={entry.payload} />
{/snippet}
