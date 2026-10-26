<script lang="ts">
  import type { DesktopBrowser, PageRect } from '@tagma/desktop/bridge';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
  import { Button } from '$lib/shared/ui/button/index.js';

  let { page, panel, bridge }: { page: PageId; panel: string; bridge: DesktopBrowser } = $props();

  let area = $state<HTMLDivElement>();
  let elsewhere = $state(false);
  let frozen = $state(false);
  let snapshot = $state<string | null>(null);
  const id = $derived(page);
  const key = $derived(panel);

  const overlapped = $derived.by(() => {
    const rects = overlayLayers.rects;
    const element = area;
    if (element === undefined || rects.length === 0) return false;
    const box = element.getBoundingClientRect();
    return rects.some(
      (rect) => rect.x < box.right && rect.x + rect.width > box.left && rect.y < box.bottom && rect.y + rect.height > box.top,
    );
  });

  $effect(() => {
    if (!overlapped || elsewhere) return;
    const shot = id;
    let gone = false;
    void bridge.capture(shot).then(
      (url) => {
        if (gone) return;
        snapshot = url;
        frozen = true;
      },
      (error: unknown) => {
        console.error(`[tagma] page ${shot} was not captured under a menu`, error);
        if (!gone) frozen = true;
      },
    );
    return () => {
      gone = true;
      frozen = false;
      requestAnimationFrame(() => {
        if (!frozen) snapshot = null;
      });
    };
  });

  $effect(() => {
    const element = area;
    if (element === undefined || elsewhere || frozen) return;
    const shown = { page: id, panel: key };
    let placed: PageRect | null = null;
    const place = () => {
      const box = element.getBoundingClientRect();
      const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
      if (rect.width < 1 || rect.height < 1) return;
      if (placed !== null && placed.x === rect.x && placed.y === rect.y && placed.width === rect.width && placed.height === rect.height)
        return;
      placed = rect;
      bridge.show(shown, rect);
    };
    const observer = new ResizeObserver(place);
    const row = element.closest('[data-side-pane]')?.parentElement ?? null;
    const watch = () => {
      observer.disconnect();
      observer.observe(element);
      for (const neighbour of row?.children ?? []) observer.observe(neighbour);
    };
    const rows = new MutationObserver(() => {
      watch();
      place();
    });
    if (row !== null) rows.observe(row, { childList: true });
    watch();
    window.addEventListener('resize', place);
    const lost = bridge.onElsewhere((gone) => {
      if (gone.page === shown.page && gone.panel === shown.panel) elsewhere = true;
    });
    place();
    return () => {
      observer.disconnect();
      rows.disconnect();
      window.removeEventListener('resize', place);
      lost();
      bridge.hide(shown);
    };
  });
</script>

<div bind:this={area} class="absolute inset-0 bg-sunken" data-native-page={page}>
  {#if elsewhere}
    <div class="grid size-full place-items-center px-6 text-center">
      <div class="grid justify-items-center gap-3">
        <p class="text-small text-muted-foreground">This page is shown in another pane.</p>
        <Button size="sm" onclick={() => (elsewhere = false)}>Show here</Button>
      </div>
    </div>
  {:else if snapshot !== null}
    <img src={snapshot} alt="" class="size-full object-cover object-left-top" draggable="false" />
  {/if}
</div>
