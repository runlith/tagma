<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';

  let { read }: { read: BlockRead } = $props();
</script>

<p data-section>{read.title}</p>
