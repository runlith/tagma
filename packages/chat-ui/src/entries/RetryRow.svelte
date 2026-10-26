<script lang="ts">
  import type { ChatEntryOf } from '../renderers';
  import RailRow from '../RailRow.svelte';
  import { useChatRendering } from '../renderers';
  import { useChatStrings } from '../strings';
  let { entry }: { entry: ChatEntryOf<'retry'> } = $props();
  const strings = useChatStrings();
  const rendering = useChatRendering();
</script>

<div data-message-id={entry.id} class="mr-auto w-full min-w-0 max-w-feed">
  <RailRow dot="bg-muted-foreground/40">
    <span class="text-ui text-muted-foreground" title={entry.message}>{strings.retry()}</span>
    <span class="font-mono text-meta text-muted-foreground/60"> · {strings.retryReason(entry.family)}</span>
    {#if rendering.context.verbose}
      <span class="font-mono text-meta text-muted-foreground/60"> · {entry.attempt}/{entry.of}</span>
    {/if}
  </RailRow>
</div>
