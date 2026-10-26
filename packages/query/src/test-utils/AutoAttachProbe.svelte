<script lang="ts">
  import type { BaseQuery } from '../types.js';

  type Props = {
    query: BaseQuery<unknown>;
  };

  let { query }: Props = $props();

  let data = $derived(query.data);
</script>

<div data-testid="auto-attach">{String(data)}</div>
