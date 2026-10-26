<script lang="ts">
  import type { BaseQuery } from '../types.js';

  type Props = {
    query: BaseQuery<unknown>;
    onRead: (read: { data: unknown; watch: unknown; isSuccess: boolean }) => void;
  };

  let { query, onRead }: Props = $props();

  onRead({ data: query.data, watch: query.watch(), isSuccess: query.isSuccess });
</script>

<div data-testid="unobserved-read"></div>
