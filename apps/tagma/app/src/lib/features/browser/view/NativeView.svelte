<script lang="ts">
  import type { DesktopBrowser, PageRect, PageShown } from '@tagma/desktop/bridge';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import { overlayLayers } from '@runlith/primitives/OverlayLayers.svelte';
  import { tick } from 'svelte';
  import { Button } from '$lib/shared/ui/button/index.js';
  import { followDrags } from './drags.js';

  const FRESH_MS = 1000;

  let { page, panel, bridge }: { page: PageId; panel: string; bridge: DesktopBrowser } = $props();

  let area = $state<HTMLDivElement>();
  let box = $state.raw<PageRect | null>(null);
  let elsewhere = $state(false);
  let dragging = $state(false);
  let parked = $state(false);
  let frame = $state<string | null>(null);
  let shot = $state<HTMLImageElement>();
  let primed: { readonly at: number; readonly frame: Promise<string | null> } | null = null;
  const shown = $derived<PageShown>({ page, panel });

  const crosses = (rect: (typeof overlayLayers.rects)[number], over: PageRect): boolean =>
    rect.x < over.x + over.width && rect.x + rect.width > over.x && rect.y < over.y + over.height && rect.y + rect.height > over.y;

  const covered = $derived.by(() => {
    const over = box;
    return over !== null && overlayLayers.rects.some((rect) => crosses(rect, over));
  });
  const frozen = $derived(covered || dragging);

  const snap = (id: PageId): Promise<string | null> =>
    bridge.capture(id).catch((error: unknown) => {
      console.error(`[tagma] page ${id} was not captured to stand under a layer`, error);
      return null;
    });

  const painted = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

  $effect(() => {
    const element = area;
    if (element === undefined) return;
    let last: PageRect | null = null;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      if (last !== null && last.x === rect.left && last.y === rect.top && last.width === rect.width && last.height === rect.height) return;
      last = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      box = last;
    };
    const observer = new ResizeObserver(measure);
    const row = element.closest('[data-side-pane]')?.parentElement ?? null;
    const watch = () => {
      observer.disconnect();
      observer.observe(element);
      for (const neighbour of row?.children ?? []) observer.observe(neighbour);
    };
    const rows = new MutationObserver(() => {
      watch();
      measure();
    });
    if (row !== null) rows.observe(row, { childList: true });
    watch();
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      rows.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  $effect(() => followDrags((held) => (dragging = held)));

  $effect(() =>
    bridge.onElsewhere((lost) => {
      if (lost.page === page && lost.panel === panel) elsewhere = true;
    }),
  );

  $effect(() => {
    if (elsewhere) return;
    const at = shown;
    $effect(() => {
      if (box !== null) bridge.show(at, box);
    });
    return () => bridge.hide(at);
  });

  $effect(() => {
    if (elsewhere || parked) return;
    return overlayLayers.onIntent(() => {
      primed = { at: performance.now(), frame: snap(page) };
    });
  });

  $effect(() => {
    if (!frozen || elsewhere) return;
    const at = shown;
    const ready = primed !== null && performance.now() - primed.at < FRESH_MS ? primed.frame : snap(page);
    primed = null;
    let gone = false;
    let sent = false;
    void (async () => {
      const url = await ready;
      if (gone) return;
      frame = url;
      await tick();
      if (url !== null && shot !== undefined)
        await shot.decode().catch((error: unknown) => console.error(`[tagma] frame of ${at.page} did not decode`, error));
      await painted();
      if (gone) return;
      sent = true;
      parked = true;
      bridge.freeze(at, true);
    })();
    return () => {
      gone = true;
      parked = false;
      if (sent) bridge.freeze(at, false);
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
  {:else if frame !== null}
    <img bind:this={shot} src={frame} alt="" class="size-full object-cover object-left-top" draggable="false" />
  {/if}
</div>
