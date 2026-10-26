<script lang="ts">
  import { elapsedDuration } from './chatTime';
  import type { ChatLiveStatus } from './liveStatus';
  let { status }: { status: ChatLiveStatus } = $props();
</script>

{#if status.phaseMs !== null}
  <span class="shrink-0 font-mono text-small tabular-nums text-muted-foreground/70">· {elapsedDuration(status.phaseMs)}</span>
{/if}
