<script lang="ts">
  import { isBlockName } from '@tagma/server/graph/contract/wire/references';
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import { Router } from '@runlith/layer/Router';
  import BlockPage from '$lib/features/graph/block/BlockPage.svelte';
  import PageClaims from '$lib/features/graph/block/PageClaims.svelte';
  import RulePanel from '$lib/features/rules/RulePanel.svelte';

  const router = Router.use();
  const blockName = $derived((router.params.id ?? '').toLowerCase());

  let read = $state.raw<BlockRead | null>(null);
</script>

{#if isBlockName(blockName)}
  <PageClaims {read} />
  {#key blockName}
    <BlockPage {blockName} bind:read>
      {#snippet enforcement(read)}
        <RulePanel {read} />
      {/snippet}
    </BlockPage>
  {/key}
{:else}
  <div class="grid h-full place-items-center text-ui text-muted-foreground">
    “{router.params.id}” is not a block name.
  </div>
{/if}
