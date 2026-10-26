<script lang="ts">
  import Circle from '@lucide/svelte/icons/circle';
  import type { Resolver } from '@runlith/layer/key';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import type { Link } from './Link.js';
  import { linkSelect, linkTarget, onLinkOpened } from './linkTarget.js';
  import type { Opening } from './Opening.svelte.js';

  let { opening, here }: { opening: Opening; here: Resolver } = $props();

  let open = $state(false);
  const link = (): Link => ({ kind: 'note', target: 'n-1' });
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger data-trigger>Open</DropdownMenu.Trigger>
  <DropdownMenu.Content {@attach onLinkOpened(() => (open = false))}>
    <DropdownMenu.Item
      icon={Circle}
      {@attach linkTarget(opening, link, here)}
      closeOnSelect={false}
      onSelect={linkSelect(opening, link, here)}
    >
      Note
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
