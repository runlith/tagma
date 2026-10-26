<script module lang="ts">
  import ThrowError from '@runlith/error-boundary/ThrowError.svelte';
  import type { ChatEntry } from '../entries';

  export { failingRow };
</script>

{#snippet failingRow(entry: ChatEntry)}
  <ThrowError error={new Error(`row ${entry.id} failed`)} />
{/snippet}
