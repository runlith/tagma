<script lang="ts">
  import { entryKindOf, type ChatEntry } from '../entries';
  import { useChatStrings } from '../strings';

  let { entry }: { entry: ChatEntry } = $props();
  const strings = useChatStrings();
</script>

<p class="font-mono text-small text-muted-foreground" data-unknown-entry={entryKindOf(entry)}>{strings.unknownEntry(entryKindOf(entry))}</p>
