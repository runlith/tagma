<script lang="ts">
  import { untrack } from 'svelte';
  import X from '@lucide/svelte/icons/x';
  import FadeText from '$lib/shared/FadeText.svelte';
  import PluginView from '../PluginView.svelte';
  import type { WindowAddress } from './ViewWindows.js';

  type Props = { address: WindowAddress; layer: number; index: number; onclose: () => void; onraise: () => void };

  let { address: panel, layer, index, onclose, onraise }: Props = $props();

  const CASCADE_PX = 24;
  const WIDTH_PX = 480;
  const HEIGHT_PX = 360;
  const MARGIN_PX = 48;
  const MIN_WIDTH_PX = 256;
  const MIN_HEIGHT_PX = 192;

  const start = untrack(() => ({ cascade: (index % 8) * CASCADE_PX, width: window.innerWidth, height: window.innerHeight }));
  const width = Math.min(WIDTH_PX, start.width);
  const height = Math.min(HEIGHT_PX, start.height);
  let frame = $state<HTMLElement | null>(null);
  let left = $state(Math.max(0, Math.min(MARGIN_PX * 2 + start.cascade, start.width - width)));
  let top = $state(Math.max(0, Math.min(MARGIN_PX + start.cascade, start.height - height)));
  let dragging = $state(false);
  let grab = { x: 0, y: 0 };

  const clamp = (value: number, high: number): number => Math.max(0, Math.min(value, high));

  function begin(event: PointerEvent): void {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button') !== null)) return;
    dragging = true;
    grab = { x: event.clientX - left, y: event.clientY - top };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent): void {
    if (!dragging) return;
    if (frame === null) return;
    left = clamp(event.clientX - grab.x, window.innerWidth - frame.offsetWidth);
    top = clamp(event.clientY - grab.y, window.innerHeight - frame.offsetHeight);
  }

  function end(): void {
    dragging = false;
  }
</script>

<section
  bind:this={frame}
  aria-label={panel.title}
  data-plugin={panel.plugin}
  data-view={panel.view}
  class="pointer-events-auto absolute flex resize flex-col overflow-hidden rounded-lg border border-border bg-background shadow-float"
  style:left={`${left}px`}
  style:top={`${top}px`}
  style:width={`${width}px`}
  style:height={`${height}px`}
  style:min-width={`${Math.min(MIN_WIDTH_PX, width)}px`}
  style:min-height={`${Math.min(MIN_HEIGHT_PX, height)}px`}
  style:z-index={layer}
  onpointerdowncapture={onraise}
  onfocusin={onraise}
>
  <header
    role="toolbar"
    tabindex="-1"
    aria-label="Window controls"
    class="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-border bg-chrome pr-1 pl-3 select-none"
    class:cursor-grabbing={dragging}
    onpointerdown={begin}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
  >
    <h2 class="min-w-0 flex-1 text-small text-muted-foreground"><FadeText text={panel.title} /></h2>
    <button
      type="button"
      aria-label="Close {panel.title}"
      class="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
      onclick={onclose}
    >
      <X class="size-3.5" />
    </button>
  </header>
  <div class="min-h-0 flex-1">
    <PluginView plugin={panel.plugin} view={panel.view} projectId={panel.projectId} threadId={null} fill />
  </div>
</section>
