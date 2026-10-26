<script lang="ts">
  import FailureRow from '../FailureRow.svelte';
  import { failureFacts, failureRaw } from '../failureFacts';
  import type { ChatEntryOf } from '../renderers';
  import { useChatStrings } from '../strings';

  let { entry }: { entry: ChatEntryOf<'error'> } = $props();
  const strings = useChatStrings();
</script>

<article data-message-id={entry.id} class="mr-auto w-full min-w-0 max-w-feed">
  <FailureRow
    id={entry.id}
    label={strings.assistantError()}
    text={entry.diagnostics.reason?.said ?? entry.text}
    facts={failureFacts(entry.diagnostics)}
    raw={failureRaw(entry.text, entry.diagnostics)}
    occurredAt={entry.occurredAt}
  />
</article>
