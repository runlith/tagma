<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  let {
    label,
    title,
    aside,
    onClose,
    children,
  }: {
    label: string;
    title?: string;
    aside?: Snippet;
    onClose: () => void;
    children: Snippet;
  } = $props();

  const CLOSE_PX = 72;

  onMount(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  let dragFrom: number | null = null;
  let pulled = $state(0);

  function grab(event: PointerEvent): void {
    if (event.button !== 0) return;
    dragFrom = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent): void {
    if (dragFrom !== null) pulled = Math.max(0, event.clientY - dragFrom);
  }

  function drop(): void {
    if (dragFrom === null) return;
    dragFrom = null;
    if (pulled > CLOSE_PX) onClose();
    pulled = 0;
  }

  function keys(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  }
</script>

<svelte:window onkeydown={keys} />

<div class="fixed inset-0 z-50 flex flex-col justify-end">
  <button
    type="button"
    class="absolute inset-0 bg-scrim"
    aria-label="Close"
    tabindex="-1"
    onclick={onClose}
    transition:fade={{ duration: 160 }}
  ></button>
  <div
    class="relative flex max-h-[88%] min-h-0 flex-col rounded-t-lg bg-popover pb-2 text-popover-foreground shadow-float safe-bottom"
    style:transform={pulled > 0 ? `translateY(${pulled}px)` : undefined}
    role="dialog"
    aria-modal="true"
    aria-label={label}
    transition:fly={{ y: 480, duration: 220, opacity: 1 }}
  >
    <div
      class="shrink-0 touch-none pt-2"
      role="presentation"
      onpointerdown={grab}
      onpointermove={drag}
      onpointerup={drop}
      onpointercancel={drop}
    >
      <div class="mx-auto mb-2 h-1 w-10 rounded-full bg-vein-strong"></div>
      {#if title !== undefined}
        <div class="flex min-h-10 items-center justify-between gap-3 px-5 pb-1">
          <h2 class="min-w-0 truncate text-page">{title}</h2>
          {#if aside}{@render aside()}{/if}
        </div>
      {/if}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {@render children()}
    </div>
  </div>
</div>
