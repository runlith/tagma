<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import type { SwipeDirection } from '@tagma/desktop/bridge';
  import { Router } from '@runlith/layer/Router';
  import { fade } from 'svelte/transition';
  import { DesktopSwipe } from '$lib/shared/desktop/DesktopSwipe.js';
  import { Swipe } from './Swipe.svelte.js';

  const SIZE = 40;
  const SHOWN = 24;
  const OVERSHOOT = 8;
  const INSET = 7;
  const ARROW = 2;
  const GROWN = 2.5;

  const router = Router.use();
  const desktop = DesktopSwipe.find();
  const open = (direction: SwipeDirection): boolean => (direction === 'back' ? router.reach.back : router.reach.forward);
  const swipe = new Swipe(open);
  const step = (direction: SwipeDirection): void => router.traverse(direction === 'back' ? -1 : 1);

  function scrolls(element: Element, direction: SwipeDirection): boolean {
    if (element.scrollWidth <= element.clientWidth + 1) return false;
    const scroller =
      element === document.scrollingElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      ['auto', 'scroll'].includes(getComputedStyle(element).overflowX);
    if (!scroller) return false;
    return direction === 'back' ? element.scrollLeft > 0 : element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
  }

  function wheeled(event: WheelEvent): void {
    if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    swipe.moved(
      event.deltaX,
      event.deltaY,
      (direction) =>
        event.defaultPrevented || event.composedPath().some((target) => target instanceof Element && scrolls(target, direction)),
    );
  }

  $effect(() => {
    if (desktop === undefined) return;
    const phases = desktop.onPhase((phase) => {
      if (phase === 'began') swipe.began();
      else if (phase === 'cancelled') swipe.cancelled();
      else {
        const direction = swipe.ended();
        if (direction !== null) step(direction);
      }
    });
    const swiped = desktop.onSwiped((direction) => {
      if (open(direction)) step(direction);
    });
    window.addEventListener('wheel', wheeled, { passive: true });
    return () => {
      phases();
      swiped();
      window.removeEventListener('wheel', wheeled);
    };
  });
</script>

{#if swipe.pull !== null}
  {@const pull = swipe.pull}
  {@const reached = Math.min(pull.progress, 1)}
  {@const shift = SHOWN * reached + OVERSHOOT * Math.max(pull.progress - 1, 0) - SIZE}
  {@const done = pull.progress >= 1}
  <div
    class={['pointer-events-none fixed inset-y-0 z-50 flex items-center', pull.direction === 'back' ? 'left-0' : 'right-0']}
    aria-hidden="true"
    out:fade={{ duration: 150 }}
  >
    <div
      class={['flex items-center rounded-full bg-sunken shadow-float', pull.direction === 'back' ? 'justify-end' : 'justify-start']}
      style="width: calc(var(--spacing) * {SIZE}); height: calc(var(--spacing) * {SIZE}); padding-inline: calc(var(--spacing) * {INSET}); transform: translateX(calc(var(--spacing) * {pull.direction ===
      'back'
        ? shift
        : -shift}))"
    >
      <div
        class={['transition-all duration-150', done ? 'text-foreground' : 'text-muted-foreground']}
        style="scale: {done ? GROWN : ARROW}"
      >
        {#if pull.direction === 'back'}<ArrowLeft class="size-4" style="stroke-width: 2.75" />{:else}<ArrowRight
            class="size-4"
            style="stroke-width: 2.75"
          />{/if}
      </div>
    </div>
  </div>
{/if}
