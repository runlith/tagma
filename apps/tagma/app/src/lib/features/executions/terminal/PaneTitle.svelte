<script module lang="ts">
  export const PANE_TITLE_HEIGHT_PX = 24;

  export type TitleRect = { readonly left: number; readonly top: number; readonly width: number };

  export function sameRect(a: TitleRect | undefined, b: TitleRect | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5;
  }

  export function confirmsComposition(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
  }
</script>

<script lang="ts">
  import SquareSplitVertical from '@lucide/svelte/icons/square-split-vertical';
  import X from '@lucide/svelte/icons/x';
  import HolderLink from './HolderLink.svelte';
  import { carriesPath, droppedPath } from './PaneHost.svelte';
  import type { TerminalPane } from './Pane.svelte.js';
  import type { TerminalTab } from './Tab.svelte.js';

  let {
    tab,
    pane,
    rect,
    onDragStart,
  }: {
    tab: TerminalTab;
    pane: TerminalPane;
    rect: TitleRect;
    onDragStart: (pane: TerminalPane, handle: HTMLElement, event: PointerEvent) => void;
  } = $props();

  let input: HTMLInputElement | null = $state(null);
  let draft = $state('');

  const editing = $derived(tab.renaming === pane.id);
  const active = $derived(tab.active === pane.id);
  const chromeless = $derived(pane.label === null && pane.holder === null && !editing);

  $effect(() => {
    if (!editing) return;
    draft = pane.label ?? '';
    input?.focus();
    input?.select();
  });

  function commit(): void {
    if (tab.renaming !== pane.id) return;
    tab.retitle(pane.id, draft);
    tab.renaming = null;
    pane.focus();
  }

  function cancel(): void {
    tab.renaming = null;
    pane.focus();
  }

  function onKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (confirmsComposition(event)) return;
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  function onDrop(event: DragEvent): void {
    const transfer = event.dataTransfer;
    const path = transfer === null || !pane.typable ? '' : droppedPath(transfer);
    if (path === '') return;
    event.preventDefault();
    event.stopPropagation();
    tab.activate(pane.id);
    pane.pastePaths([path]);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane-title-bar"
  data-pane-prevent-terminal-focus=""
  data-pane-title={pane.id}
  data-active-pane={active ? '' : undefined}
  data-chromeless={chromeless ? '' : undefined}
  data-editing={editing ? '' : undefined}
  style:left={`${rect.left}px`}
  style:top={`${rect.top}px`}
  style:width={`${rect.width}px`}
  onpointerdowncapture={() => tab.activate(pane.id)}
  oncontextmenu={(event) => {
    if (tab.openMenu(pane.id, event.clientX, event.clientY)) event.preventDefault();
  }}
  ondragover={(event) => {
    const transfer = event.dataTransfer;
    if (transfer === null || !pane.typable || !carriesPath(transfer)) return;
    event.preventDefault();
    transfer.dropEffect = 'copy';
  }}
  ondrop={onDrop}
>
  {#if editing}
    <input
      bind:this={input}
      bind:value={draft}
      class="pane-title-input"
      data-pane-title-input
      placeholder="Pane title"
      aria-label="Pane title"
      onkeydown={onKey}
      onblur={commit}
    />
  {:else}
    {#if tab.count > 1 && !chromeless}
      <div class="pane-title-drag-handle" aria-hidden="true" onpointerdown={(event) => onDragStart(pane, event.currentTarget, event)}></div>
    {/if}
    {#if pane.label !== null}
      <button
        type="button"
        class="pane-title-text"
        data-pane-title-text
        aria-label={`Edit pane title: ${pane.label}`}
        onclick={() => (tab.renaming = pane.id)}
      >
        {pane.label}
      </button>
    {/if}
    {#if pane.holder !== null}
      <HolderLink class="pane-title-holder" holder={pane.holder} />
    {/if}
    <div class="pane-title-actions">
      <button
        type="button"
        class="pane-title-split"
        data-pane-title-split
        aria-label="Split Terminal Right"
        onclick={(event) => {
          event.stopPropagation();
          void tab.split(pane, 'row');
        }}
      >
        <SquareSplitVertical class="size-3" />
      </button>
      {#if pane.label !== null}
        <button
          type="button"
          class="pane-title-close"
          data-pane-title-remove
          aria-label={`Remove pane title: ${pane.label}`}
          onclick={(event) => {
            event.stopPropagation();
            tab.retitle(pane.id, null);
          }}
        >
          <X class="size-3" />
        </button>
      {:else}
        <button
          type="button"
          class="pane-title-close"
          data-pane-title-close
          aria-label="Close Pane"
          onclick={(event) => {
            event.stopPropagation();
            tab.close(pane.id);
          }}
        >
          <X class="size-3" />
        </button>
      {/if}
    </div>
  {/if}
</div>
