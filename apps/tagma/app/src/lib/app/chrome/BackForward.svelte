<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import { Host } from '@runlith/layer/Host';
  import { Router } from '@runlith/layer/Router';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';
  import { spellChord } from '$lib/shared/chordSpelling.js';
  import { Button } from '$lib/shared/ui/button/index.js';

  type Direction = -1 | 1;

  const router = Router.use();
  const mac = Host.use().apple;

  let canBack = $state(navigation.canGoBack);
  let canForward = $state(navigation.canGoForward);

  $effect(() => {
    const sync = (): void => {
      canBack = navigation.canGoBack;
      canForward = navigation.canGoForward;
    };
    navigation.addEventListener('currententrychange', sync);
    return () => navigation.removeEventListener('currententrychange', sync);
  });

  function go(direction: Direction): void {
    if (direction < 0 ? navigation.canGoBack : navigation.canGoForward) router.traverse(direction);
  }

  function chordOf(event: KeyboardEvent): Direction | null {
    if (event.shiftKey || event.ctrlKey) return null;
    if (mac) {
      if (!event.metaKey || event.altKey) return null;
      return event.code === 'BracketLeft' ? -1 : event.code === 'BracketRight' ? 1 : null;
    }
    if (!event.altKey || event.metaKey) return null;
    return event.code === 'ArrowLeft' ? -1 : event.code === 'ArrowRight' ? 1 : null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const direction = chordOf(event);
    if (direction === null) return;
    event.preventDefault();
    go(direction);
  }

  function onMouseup(event: MouseEvent): void {
    if (event.defaultPrevented || (event.button !== 3 && event.button !== 4)) return;
    event.preventDefault();
    go(event.button === 3 ? -1 : 1);
  }

  const travel = (macKey: string, otherKey: string): string =>
    spellChord({ key: mac ? macKey : otherKey, meta: mac, ctrl: false, alt: !mac, shift: false }, mac);
  const backKeys = travel('[', 'ArrowLeft');
  const forwardKeys = travel(']', 'ArrowRight');
</script>

<svelte:window onkeydown={onKeydown} onmouseup={onMouseup} />

<div class="mr-1 flex shrink-0 items-center gap-0.5">
  <Tooltip text="Back" keys={backKeys} side="bottom">
    <Button size="icon-sm" variant="quiet" class="no-drag-region" aria-label="Back" disabled={!canBack} onclick={() => go(-1)}>
      <ArrowLeft class="size-3.5" />
    </Button>
  </Tooltip>
  <Tooltip text="Forward" keys={forwardKeys} side="bottom">
    <Button size="icon-sm" variant="quiet" class="no-drag-region" aria-label="Forward" disabled={!canForward} onclick={() => go(1)}>
      <ArrowRight class="size-3.5" />
    </Button>
  </Tooltip>
</div>
