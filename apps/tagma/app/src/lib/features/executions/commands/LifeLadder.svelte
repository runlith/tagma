<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import TimeLadder from '$lib/shared/ui/TimeLadder.svelte';
  import type { CommandView } from './Activity.svelte.js';
  import { elapsedMs, type ProcessLine } from '../processes/lines.js';

  let {
    line,
    view,
    class: className,
    children,
  }: { line: ProcessLine; view: CommandView; class?: ClassValue; children: Snippet } = $props();

  const limit = $derived(line.limit);
  const elapsed = $derived(elapsedMs(line, view.now) ?? 0);
  const origin = $derived(
    limit !== null && limit.expiresAt !== null && limit.executionMs !== null ? limit.expiresAt - limit.executionMs : line.startedAt,
  );
</script>

{#if limit !== null}
  <TimeLadder
    title="Life"
    label="Change how long this command may run before it is stopped"
    elapsedMs={elapsed}
    limitMs={limit.executionMs}
    ceilingMs={limit.ceilingMs}
    originAt={origin}
    disabled={view.busy(line.key) !== null}
    pick={(ms) => view.reviseLife(line, ms)}
    class={className}
  >
    {@render children()}
  </TimeLadder>
{/if}
