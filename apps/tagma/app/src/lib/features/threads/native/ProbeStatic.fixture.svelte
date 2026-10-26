<script lang="ts" module>
  import type { ChatEntryContext } from '@runlith/chat-ui/renderers';
  import type { ProductEntry } from '@runlith/chat-ui/entries';
  import { productKindDeclaration, type KindDeclaration } from './contribution.js';
  import { type Probe, probeKind } from './Probe.fixture.svelte';

  export const kinds: readonly KindDeclaration[] = [productKindDeclaration({ ...probeKind, render: staticRow })];
</script>

{#snippet staticRow(entry: ProductEntry<Probe>, _view: ChatEntryContext)}
  <span>{entry.payload.label}</span>
{/snippet}
