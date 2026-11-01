<script lang="ts">
  import type { ListedBlock } from '@tagma/server/graph/contract/wire/rows';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import { type StatusAction, statusText } from '$lib/features/graph/status.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';

  const tags = TagCatalog.use();

  let { block, store }: { block: ListedBlock; store: TreeScreen } = $props();

  const actions = $derived(tags.actions(block));

  function run(action: StatusAction): void {
    const op = action.op;
    if (op === null) void store.setStatus(block.identity, action.to);
    else if (op === 'claim_block') void store.claim(block.identity);
    else if (op === 'release_block') void store.release(block.identity);
    else if (op === 'finish_block') void store.done(block.identity);
    else if (op === 'close_block') void store.close(block.identity);
    else op satisfies never;
  }
</script>

{#each actions as action (`${action.op ?? 'set'}:${action.to}`)}
  <DropdownMenu.Item onSelect={() => run(action)}>
    {#snippet lead()}<span class={cn('size-2 bg-current', statusText(action.to))}></span>{/snippet}
    {action.label}
  </DropdownMenu.Item>
{/each}
