<script lang="ts">
  import type { ChatEntry } from './entries';
  import { elapsedDuration } from './chatTime';
  import { useChatStrings } from './strings';
  let { entry }: { entry: Extract<ChatEntry, { kind: 'run-end' }> } = $props();
  const strings = useChatStrings();
  const duration = $derived(Math.max(0, Date.parse(entry.finishedAt) - Date.parse(entry.startedAt)));
</script>

<p class="mr-auto min-w-0 max-w-feed text-meta tabular-nums text-muted-foreground/55">
  {strings.runEnding(entry.status, elapsedDuration(duration))}
</p>
