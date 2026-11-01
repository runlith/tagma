<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import Engine from './Engine.svelte';
  import RuleText from './RuleText.svelte';

  let { read }: { read: BlockRead } = $props();

  const tags = TagCatalog.use();
</script>

{#if tags.enforced(read)}
  <Engine name={read.identity} updatedAt={read.updatedAt} />
{:else if !tags.switchedOff(read)}
  <RuleText name={read.identity} />
{/if}
