<script lang="ts">
  import { App } from '@runlith/layer/svelte/App.svelte';
  import { linkSelect, linkTarget } from '$lib/features/opening/linkTarget.js';
  import { Opening } from '$lib/features/opening/Opening.svelte.js';
  import * as DropdownMenu from '$lib/shared/ui/dropdown-menu/index.js';
  import ChangesIcon from './ChangesIcon.svelte';
  import ChangesTail from './ChangesTail.svelte';
  import { changesTail, threadChangesLink } from './changesTail.js';
  import { ThreadChanges } from './ThreadChanges.svelte.js';

  const changes = ThreadChanges.use();
  const opening = Opening.use();
  const here = App.current();

  const paths = $derived(changes.held?.paths ?? 0);
  const unproven = $derived(changes.held?.unproven ?? 0);
  const said = $derived(changesTail(changes));
  const link = () => threadChangesLink(changes);
</script>

{#if !changes.empty}
  <DropdownMenu.Item
    {@attach linkTarget(opening, link, here)}
    closeOnSelect={false}
    onSelect={linkSelect(opening, link, here)}
    data-thread-changes={paths}
    data-thread-changes-unproven={unproven}
  >
    {#snippet lead()}<ChangesIcon unchecked={unproven > 0} />{/snippet}
    {#snippet tail()}<ChangesTail tail={said} />{/snippet}
    Changes
  </DropdownMenu.Item>
{/if}
