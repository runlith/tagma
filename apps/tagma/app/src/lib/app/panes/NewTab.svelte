<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import type { Snippet } from 'svelte';
  import { buttonVariants } from '$lib/shared/ui/button/index.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Access, gateOf } from '$lib/wire/access.js';
  import { cn } from '$lib/shared/utils.js';
  import { SidePanes } from './SidePanes.svelte.js';

  let { trigger, label = 'New tab', align = 'start' }: { trigger?: Snippet; label?: string; align?: 'start' | 'end' } = $props();

  const panes = SidePanes.use();
  const gate = gateOf(Access.find());
</script>

<DropdownMenu.Root>
  <Tooltip text={label}>
    <DropdownMenu.Trigger class={cn(buttonVariants({ variant: 'quiet', size: 'icon-sm' }), 'no-drag-region')} aria-label={label}>
      {#if trigger}{@render trigger()}{:else}<Plus class="size-3.5" />{/if}
    </DropdownMenu.Trigger>
  </Tooltip>
  <DropdownMenu.Content {align} class="max-h-96 min-w-56 overflow-y-auto">
    {#each panes.kinds.offers.filter((offer) => gate.allows(offer.right)) as offer (offer)}
      {@const Offer = offer.view}
      <Offer />
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
