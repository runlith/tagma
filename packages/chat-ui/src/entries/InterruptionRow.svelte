<script lang="ts">
  import RailRow from '../RailRow.svelte';
  import type { ChatEntryOf } from '../renderers';
  import { useChatStrings } from '../strings';

  type Props = {
    entry: ChatEntryOf<'interruption'>;
  };

  let { entry }: Props = $props();
  const strings = useChatStrings();
</script>

<div data-message-id={entry.id} class="mr-auto w-full min-w-0 max-w-feed">
  <RailRow dot="bg-chat-interrupted/70">
    <p class="text-ui text-chat-interrupted-label/90">
      {entry.text ?? strings.interruptedByUser()}
    </p>
  </RailRow>
</div>
