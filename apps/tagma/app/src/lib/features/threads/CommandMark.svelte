<script lang="ts" module>
  import type { CommandView } from '$lib/features/executions/commands/Activity.svelte.js';
  import { isLive, isQueued, type ProcessLine } from '$lib/features/executions/processes/lines.js';

  export function commandDot(line: ProcessLine, view: CommandView): string {
    if (!isLive(line)) {
      const failed = line.exit !== null && !(line.exit._tag === 'Code' && line.exit.code === 0);
      return failed ? 'bg-chat-failure/80' : 'bg-muted-foreground/40';
    }
    if (view.unconfirmed(line) !== null) return 'border border-dashed border-muted-foreground bg-transparent';
    if (isQueued(line)) return 'border border-muted-foreground/50 bg-transparent';
    return 'animate-breathe bg-status-done';
  }
</script>

<span class="shrink-0 text-muted-foreground/70" data-command-mark>Background</span>
