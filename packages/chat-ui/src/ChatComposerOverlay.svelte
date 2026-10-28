<script lang="ts">
  import { wheelCrossesOut, wheelDistance } from '@runlith/scroll-follow/scrollFollow';
  import type { Snippet } from 'svelte';
  import JumpToLatest from './JumpToLatest.svelte';
  import type { ChatLiveTail } from './liveStatus';
  import type { TranscriptViewport } from './TranscriptViewport.svelte';
  import type { VisibleFeed } from './VisibleFeed';

  type Props = {
    viewport: TranscriptViewport;
    feed: VisibleFeed;
    clockOffset: number;
    tail: ChatLiveTail | null;
    still: boolean;
    onClearance(height: number): void;
    children: Snippet;
  };

  let { viewport, feed, clockOffset, tail, still, onClearance, children }: Props = $props();

  const jumpShown = $derived(viewport.state.overflow && viewport.state.jump);

  let host: HTMLDivElement | undefined = $state();

  $effect(() => {
    const element = host;
    if (!element || typeof ResizeObserver === 'undefined') return;

    onClearance(element.offsetHeight);
    const observer = new ResizeObserver(() => onClearance(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    const element = host;
    if (!element) return;
    let touchY: number | null = null;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented) return;
      const root = viewport.viewport;
      if (!root) return;
      const delta = wheelDistance({ deltaY: event.deltaY, deltaMode: event.deltaMode, rootHeight: root.clientHeight });
      if (delta === 0 || insidePopup(event.target)) return;
      if (innerScrollableFor(event.target, element, delta)) return;
      event.preventDefault();
      viewport.scrollBy(delta);
    };
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touchY === null || event.touches.length !== 1 || touch === undefined) return;
      const delta = touchY - touch.clientY;
      if (delta === 0) return;
      if (insidePopup(event.target) || innerScrollableFor(event.target, element, delta)) {
        touchY = null;
        return;
      }
      event.preventDefault();
      touchY = touch.clientY;
    };
    const onTouchEnd = () => {
      touchY = null;
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    };
  });

  function insidePopup(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('[data-composer-popup]') !== null;
  }

  function innerScrollableFor(target: EventTarget | null, root: HTMLElement, deltaY: number): HTMLElement | null {
    let node = target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
    while (node && node !== root) {
      const style = node.scrollHeight > node.clientHeight ? getComputedStyle(node) : null;
      if (style && /(auto|scroll)/.test(style.overflowY)) {
        if (style.overscrollBehaviorY !== 'auto') return node;
        const crosses = wheelCrossesOut({
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          scrollTop: node.scrollTop,
          delta: deltaY,
        });
        if (!crosses) return node;
      }
      node = node.parentElement;
    }
    return null;
  }
</script>

<div bind:this={host} class="pointer-events-none absolute inset-x-0 bottom-0 z-40 px-3 pb-3 pt-2">
  <div class="pointer-events-auto relative">
    <div
      class={[
        'pointer-events-none absolute inset-x-0 -top-10 z-30 flex justify-center px-6 transition',
        jumpShown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      ]}
    >
      <JumpToLatest {feed} {clockOffset} {tail} {still} shown={jumpShown} onJump={() => viewport.resume()} />
    </div>
    {@render children()}
  </div>
</div>
