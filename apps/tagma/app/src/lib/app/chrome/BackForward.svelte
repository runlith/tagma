<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { Router } from '@runlith/layer/Router';
  import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';

  type Direction = -1 | 1;

  const router = Router.use();
  const keymap = Keymap.use();

  function go(direction: Direction): void {
    if (direction < 0 ? router.reach.back : router.reach.forward) router.traverse(direction);
  }

  function onMouseup(event: MouseEvent): void {
    if (event.defaultPrevented || (event.button !== 3 && event.button !== 4)) return;
    event.preventDefault();
    go(event.button === 3 ? -1 : 1);
  }
</script>

<svelte:window onmouseup={onMouseup} />

<div class="mr-1 flex shrink-0 items-center gap-0.5">
  <Tooltip text="Back" keys={keymap.spell('history.back')} side="bottom">
    <Button size="icon-sm" variant="quiet" class="no-drag-region" aria-label="Back" disabled={!router.reach.back} onclick={() => go(-1)}>
      <ArrowLeft class="size-3.5" />
    </Button>
  </Tooltip>
  <Tooltip text="Forward" keys={keymap.spell('history.forward')} side="bottom">
    <Button
      size="icon-sm"
      variant="quiet"
      class="no-drag-region"
      aria-label="Forward"
      disabled={!router.reach.forward}
      onclick={() => go(1)}
    >
      <ArrowRight class="size-3.5" />
    </Button>
  </Tooltip>
</div>
