<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import BlockPage from '$lib/features/graph/block/BlockPage.svelte';
  import PageClaims from '$lib/features/graph/block/PageClaims.svelte';

  let read = $state.raw<BlockRead | null>(null);
</script>

<PageClaims {read} />
<BlockPage bind:read />
