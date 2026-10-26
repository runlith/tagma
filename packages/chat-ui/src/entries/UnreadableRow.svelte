<script lang="ts">
  import FailureRow from '../FailureRow.svelte';
  import type { ChatEntryOf } from '../renderers';
  import { useChatStrings } from '../strings';

  let { entry }: { entry: ChatEntryOf<'unreadable'> } = $props();
  const strings = useChatStrings();
</script>

<article data-message-id={entry.id} class="mr-auto w-full min-w-0">
  <FailureRow
    id={entry.id}
    label={strings.unreadableEntry(entry.refusal.type ?? '?')}
    text={entry.refusal.message}
    occurredAt={entry.occurredAt}
  />
</article>
