<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import BlockPage from '$lib/features/graph/block/BlockPage.svelte';
  import PageClaims from '$lib/features/graph/block/PageClaims.svelte';
  import RulePanel from '$lib/features/rules/RulePanel.svelte';

  let read = $state.raw<BlockRead | null>(null);
</script>

<PageClaims {read} />
<BlockPage bind:read>
  {#snippet enforcement(read)}
    <RulePanel {read} />
  {/snippet}
</BlockPage>
