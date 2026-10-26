<script lang="ts">
  import type { BaseQuery } from '../types.js';

  type Props = {
    query: BaseQuery<unknown>;
  };

  let { query }: Props = $props();
</script>

{#if query.isLoading}
  <div data-testid="loading">loading</div>
{:else}
  <div data-testid="data">{String(query.data)}</div>
{/if}
