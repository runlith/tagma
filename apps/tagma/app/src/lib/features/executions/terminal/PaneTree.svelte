<script module lang="ts">
  export const DRAG_THRESHOLD_PX = 5;
</script>

<script lang="ts">
  import TerminalContextMenu from './ContextMenu.svelte';
  import TerminalDivider from './Divider.svelte';
  import TerminalPaneHost from './PaneHost.svelte';
  import TerminalPaneTitle, { PANE_TITLE_HEIGHT_PX, sameRect, type TitleRect } from './PaneTitle.svelte';
  import { hasPane, isMoveNoOp, nearestZone, sideFlex, sideHidden, zoneRect, type DropZone, type PaneNode } from './paneLayout.js';
  import type { TerminalAppearance } from '../appearance/Settings.svelte.js';
  import type { TerminalKeymap } from './Keymap.js';
  import type { TerminalPane } from './Pane.svelte.js';
  import type { TerminalTab } from './Tab.svelte.js';
  import type { Snippet } from 'svelte';

  let {
    tab,
    keymap,
    appearance,
    isMac,
    dictation,
    detach,
  }: {
    tab: TerminalTab;
    keymap: TerminalKeymap;
    appearance: TerminalAppearance;
    isMac: boolean;
    dictation?: Snippet<[TerminalPane, HTMLElement]>;
    detach?: (pane: string) => void;
  } = $props();

  let root: HTMLDivElement | null = $state(null);
  let rects = $state<Record<string, TitleRect>>({});
  let overlay = $state<{ left: number; top: number; width: number; height: number } | null>(null);

  const style = $derived(tab.style);

  const standing = (id: string): TerminalPane[] => {
    const pane = tab.panes.get(id);
    return pane === undefined ? [] : [pane];
  };
  const ordered = $derived(tab.order.flatMap(standing));

  $effect(() => {
    tab.mount();
    return () => tab.unmount();
  });

  $effect(() => {
    const element = root;
    void tab.layout;
    void tab.expanded;
    if (element === null) return;
    let frame: number | null = null;
    const sync = (): void => {
      const box = element.getBoundingClientRect();
      const next: Record<string, TitleRect> = {};
      for (const pane of element.querySelectorAll<HTMLElement>('.pane[data-pane-id]')) {
        const id = pane.dataset.paneId;
        const rect = pane.getBoundingClientRect();
        if (id === undefined || rect.width <= 0 || rect.height <= 0) continue;
        next[id] = { left: rect.left - box.left, top: rect.top - box.top, width: rect.width };
      }
      const keys = new Set([...Object.keys(next), ...Object.keys(rects)]);
      for (const key of keys) {
        if (!sameRect(next[key], rects[key])) {
          rects = next;
          return;
        }
      }
    };
    const schedule = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    for (const pane of element.querySelectorAll<HTMLElement>('.pane[data-pane-id]')) observer.observe(pane);
    sync();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  });

  function onDragStart(pane: TerminalPane, handle: HTMLElement, event: PointerEvent): void {
    if ((event.button ?? 0) !== 0 || event.ctrlKey || tab.count < 2) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const held = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;

    const stop = (commit: boolean): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      handle.removeEventListener('lostpointercapture', onCancel);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('blur', onBlur, true);
      window.removeEventListener('keydown', onKey, true);
      try {
        if (handle.hasPointerCapture(held)) handle.releasePointerCapture(held);
      } catch {}
      if (!dragging) return;
      dragging = false;
      const target = tab.drop;
      tab.dragging = null;
      tab.drop = null;
      overlay = null;
      if (commit && target !== null) tab.move(pane.id, target.pane, target.zone);
    };

    const onMove = (moved: PointerEvent): void => {
      if (moved.pointerId !== held) return;
      if (!dragging && Math.hypot(moved.clientX - startX, moved.clientY - startY) >= DRAG_THRESHOLD_PX) {
        dragging = true;
        tab.dragging = pane.id;
      }
      if (dragging) aim(pane.id, moved.clientX, moved.clientY);
    };
    const onUp = (up: PointerEvent): void => {
      if (up.pointerId === held) stop(true);
    };
    const onCancel = (cancelled: PointerEvent): void => {
      if (cancelled.pointerId === held) stop(false);
    };
    const onBlur = (): void => stop(false);
    const onKey = (key: KeyboardEvent): void => {
      if (key.key === 'Escape') stop(false);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    handle.addEventListener('lostpointercapture', onCancel);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('blur', onBlur, true);
    window.addEventListener('keydown', onKey, true);
  }

  function aim(sourceId: string, x: number, y: number): void {
    const element = root;
    if (element === null) return;
    for (const box of element.querySelectorAll<HTMLElement>('.pane[data-pane-id]')) {
      const id = box.dataset.paneId;
      if (id === undefined || id === sourceId) continue;
      const rect = box.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const zone: DropZone = nearestZone({ x, y }, rect);
      if (isMoveNoOp(tab.layout, sourceId, id, zone)) break;
      tab.drop = { pane: id, zone };
      overlay = zoneRect(rect, zone);
      return;
    }
    tab.drop = null;
    overlay = null;
  }

  const holdsExpanded = (node: PaneNode): boolean => tab.expanded !== null && hasPane(node, tab.expanded);
</script>

{#snippet branch(node: PaneNode, path: number[], flex: string, hidden: boolean)}
  {#if node.kind === 'pane'}
    {#each standing(node.id) as pane (pane.id)}
      <TerminalPaneHost
        {pane}
        {isMac}
        {onDragStart}
        {flex}
        {hidden}
        {style}
        active={tab.active === pane.id}
        renaming={tab.renaming === pane.id}
        dragging={tab.dragging === pane.id}
        {dictation}
        onActivate={(paneId, focusEngine) => tab.activate(paneId, focusEngine)}
        onFollowMouse={(paneId, buttons) => tab.followMouse(paneId, buttons)}
        onMenu={(paneId, x, y) => tab.openMenu(paneId, x, y)}
      />
    {/each}
  {:else}
    <div
      class="pane-split"
      class:is-vertical={node.direction === 'row'}
      class:is-horizontal={node.direction === 'column'}
      style:display={hidden ? 'none' : 'flex'}
      style:flex-direction={node.direction}
      style:flex
    >
      {@render branch(node.children[0], [...path, 0], sideFlex(node, 0, tab.expanded), sideHidden(node, 0, tab.expanded))}
      <TerminalDivider {tab} {path} direction={node.direction} thickness={style.dividerThicknessPx} hidden={holdsExpanded(node)} />
      {@render branch(node.children[1], [...path, 1], sideFlex(node, 1, tab.expanded), sideHidden(node, 1, tab.expanded))}
    </div>
  {/if}
{/snippet}

<div
  bind:this={root}
  class="pane-tree"
  class:has-multiple-panes={tab.count > 1}
  class:is-pane-dragging={tab.dragging !== null}
  style:--divider-color={appearance.dividerColor}
  style:--pane-title-bg={appearance.paneBackground}
  style:--pane-title-height={`${PANE_TITLE_HEIGHT_PX}px`}
>
  {@render branch(tab.layout, [], '1 1 0%', false)}

  <div class="pane-title-overlay-layer" data-pane-title-surface={appearance.titleTone}>
    {#each ordered as pane (pane.id)}
      {@const rect = rects[pane.id]}
      {#if rect !== undefined}
        <TerminalPaneTitle {tab} {pane} {rect} {onDragStart} />
      {/if}
    {/each}
  </div>
</div>

{#if overlay !== null}
  <div
    class="pane-drop-overlay"
    data-pane-drop-overlay
    style:left={`${overlay.left}px`}
    style:top={`${overlay.top}px`}
    style:width={`${overlay.width}px`}
    style:height={`${overlay.height}px`}
  ></div>
{/if}

<TerminalContextMenu {tab} {keymap} {detach} />

<style>
  .pane-tree {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    --seam-line: var(--divider-color, transparent);
    --seam-line-active: color-mix(in srgb, var(--divider-color, transparent) 75%, var(--ink-on-dark));
  }

  :global(.pane-tree .pane-split) {
    min-width: 0;
    min-height: 0;
  }

  :global(.pane-tree .pane-drag-handle) {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    cursor: grab;
    background: color-mix(in oklch, var(--ink-on-dark) 15%, transparent);
    transition: opacity 150ms ease;
    pointer-events: none;
  }

  :global(.pane-tree .pane-drag-handle::after) {
    content: '···';
    font-size: var(--text-meta);
    line-height: 1;
    color: color-mix(in oklch, var(--ink-on-dark) 45%, transparent);
  }

  :global(.pane-tree.has-multiple-panes .pane-drag-handle) {
    pointer-events: auto;
  }

  :global(.pane-tree.has-multiple-panes .pane-drag-handle:hover) {
    opacity: 1;
  }

  :global(.pane-tree .pane-drag-handle:active) {
    cursor: grabbing;
  }

  :global(.pane-tree .pane.is-drag-source) {
    opacity: 0.4 !important;
  }

  :global(.pane-tree.is-pane-dragging .pane) {
    pointer-events: none;
  }

  .pane-drop-overlay {
    position: fixed;
    z-index: 9999;
    border: 2px solid color-mix(in oklch, var(--status-open) 50%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklch, var(--status-open) 20%, transparent);
    pointer-events: none;
  }

  :global(.pane-tree .pane.pane-focus-rim-flash::before) {
    content: '';
    position: absolute;
    inset: 1px;
    z-index: 30;
    border: 1.5px solid color-mix(in srgb, var(--color-brand) 68%, transparent);
    border-radius: var(--radius-sm);
    outline: 2px solid color-mix(in srgb, var(--color-brand) 34%, transparent);
    animation: pane-focus-rim-flash 1.5s ease-out forwards;
    pointer-events: none;
  }

  @keyframes pane-focus-rim-flash {
    0% {
      opacity: 1;
    }
    24% {
      opacity: 0.42;
    }
    46% {
      opacity: 0;
    }
    100% {
      opacity: 0;
    }
  }

  .pane-title-overlay-layer {
    position: absolute;
    inset: 0;
    z-index: 20;
    pointer-events: none;
    --pane-title-height: 24px;
    --pane-title-ink: var(--ink-on-dark);
    --pane-title-fg: color-mix(in oklch, var(--pane-title-ink) 52%, transparent);
    --pane-title-button-fg: var(--pane-title-ink);
    --pane-title-button-hover-fg: var(--pane-title-ink);
    --pane-title-input-bg: color-mix(in oklch, var(--pane-title-ink) 4%, transparent);
    --pane-title-separator: color-mix(in oklch, var(--pane-title-ink) 6%, transparent);
  }

  .pane-title-overlay-layer[data-pane-title-surface='light'] {
    --pane-title-ink: var(--ink-on-light);
    --pane-title-fg: color-mix(in oklch, var(--pane-title-ink) 62%, transparent);
    --pane-title-button-fg: var(--pane-title-ink);
    --pane-title-button-hover-fg: var(--pane-title-ink);
    --pane-title-input-bg: color-mix(in oklch, var(--pane-title-ink) 5%, transparent);
    --pane-title-separator: color-mix(in oklch, var(--pane-title-ink) 8%, transparent);
  }

  :global(.pane-title-overlay-layer .pane-title-bar) {
    position: absolute;
    box-sizing: border-box;
    height: var(--pane-title-height);
    display: flex;
    align-items: center;
    padding: 0 calc(var(--spacing) * 2);
    color: var(--pane-title-fg);
    background: var(--pane-title-bg);
    border-bottom: 1px solid var(--pane-title-separator);
    font-size: var(--text-ui);
    font-family: var(--font-mono);
    pointer-events: auto;
    user-select: none;
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless]) {
    padding: 0 calc(var(--spacing) * 0.5);
    background: transparent;
    border-bottom: none;
    pointer-events: none;
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-split),
  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-close) {
    position: relative;
    min-width: 18px;
    padding: 0;
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-close) {
    margin-left: -1px;
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-split::before),
  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-close::before) {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 23px;
    height: 23px;
    border-radius: var(--radius-full);
    background: radial-gradient(
      circle,
      var(--pane-title-bg) 0 44%,
      color-mix(in srgb, var(--pane-title-bg) 74%, transparent) 62%,
      transparent 100%
    );
    transform: translate(-50%, -50%);
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-split svg),
  :global(.pane-title-overlay-layer .pane-title-bar[data-chromeless] .pane-title-close svg) {
    position: relative;
    stroke-width: 2.75px;
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-editing]) {
    padding: 0;
  }

  :global(.pane-title-overlay-layer .pane-title-drag-handle) {
    position: absolute;
    top: 0;
    left: 50%;
    width: 32px;
    height: var(--pane-title-height);
    z-index: 2;
    opacity: 0;
    cursor: grab;
    background: color-mix(in srgb, var(--pane-title-fg) 36%, transparent);
    transform: translateX(-50%);
    transition: opacity 150ms ease;
  }

  :global(.pane-title-overlay-layer .pane-title-drag-handle:hover) {
    opacity: 1;
  }

  :global(.pane-title-overlay-layer .pane-title-drag-handle:active) {
    cursor: grabbing;
  }

  :global(.pane-title-overlay-layer .pane-title-text) {
    flex: 1;
    min-width: 0;
    align-self: stretch;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: left;
    color: inherit;
    font: inherit;
    line-height: var(--pane-title-height);
    cursor: pointer;
  }

  :global(.pane-title-overlay-layer .pane-title-holder) {
    padding-left: calc(var(--spacing) * 2);
    font-size: var(--text-small);
    opacity: 0.7;
  }

  :global(.pane-title-overlay-layer .pane-title-actions) {
    position: relative;
    z-index: 3;
    display: flex;
    flex: none;
    margin-left: auto;
    align-items: center;
    pointer-events: auto;
  }

  :global(.pane-title-overlay-layer .pane-title-split),
  :global(.pane-title-overlay-layer .pane-title-close) {
    display: grid;
    place-items: center;
    width: 18px;
    height: var(--pane-title-height);
    color: var(--pane-title-button-fg);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  :global(.pane-title-overlay-layer .pane-title-bar[data-active-pane] .pane-title-split),
  :global(.pane-title-overlay-layer .pane-title-bar:hover .pane-title-split),
  :global(.pane-title-overlay-layer .pane-title-bar:hover .pane-title-close),
  :global(.pane-title-overlay-layer .pane-title-bar:focus-within .pane-title-split),
  :global(.pane-title-overlay-layer .pane-title-bar:focus-within .pane-title-close) {
    opacity: 1;
  }

  :global(.pane-title-overlay-layer .pane-title-split:hover),
  :global(.pane-title-overlay-layer .pane-title-close:hover) {
    color: var(--pane-title-button-hover-fg);
  }

  :global(.pane-title-overlay-layer .pane-title-input) {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: var(--pane-title-height);
    padding: 0 calc(var(--spacing) * 2);
    border: 1px solid transparent;
    background: var(--pane-title-input-bg);
    color: var(--pane-title-fg);
    outline: none;
    font-size: var(--text-ui);
    font-family: var(--font-mono);
  }
</style>
