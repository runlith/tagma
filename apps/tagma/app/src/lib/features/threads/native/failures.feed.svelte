<script lang="ts">
  import type { EntryKinds } from '@runlith/chat-ui/EntryKinds.svelte';
  import type { ChatEntryOf } from '@runlith/chat-ui/renderers';
  import TurnFailure from './TurnFailure.svelte';

  let { kinds, contributor }: { kinds: EntryKinds; contributor: string } = $props();

  $effect.pre(() => kinds.register(contributor, { kind: 'error', render: failureRow }));
</script>

{#snippet failureRow(entry: ChatEntryOf<'error'>)}
  <TurnFailure {entry} />
{/snippet}
