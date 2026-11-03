<script lang="ts">
  import FailureRow from '@runlith/chat-ui/FailureRow.svelte';
  import type { PickEntry } from '@tagma/server/threads/contract/wire/harness/pick';

  let { entry }: { entry: PickEntry } = $props();
</script>

<article class="mr-auto w-full min-w-0 max-w-feed" data-model-pick={entry.model}>
  <FailureRow id={entry.id} label={`Did not move to ${entry.model}`} text={entry.reason} occurredAt={entry.occurredAt} />
</article>
