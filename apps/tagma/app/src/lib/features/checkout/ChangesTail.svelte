<script lang="ts">
  import type { ChangesTail } from './changesTail.js';
  import { counted, uncheckedWords } from './holdingWords.js';
  import LineCount from './LineCount.svelte';

  let { tail }: { tail: ChangesTail | null } = $props();
</script>

{#if tail?.kind === 'lines'}
  <LineCount lines={tail.lines} />
{:else if tail?.kind === 'files'}
  <span class="text-meta tabular-nums text-muted-foreground">{counted(tail.count, 'file', 'files')}</span>
{:else if tail?.kind === 'unchecked'}
  <span class="text-meta tabular-nums text-status-stale">{uncheckedWords(tail.count)}</span>
{/if}
