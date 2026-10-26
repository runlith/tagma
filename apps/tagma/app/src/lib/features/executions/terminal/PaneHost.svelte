<script module lang="ts">
  const EDITABLE = [
    'input:not(.xterm-helper-textarea)',
    'textarea:not(.xterm-helper-textarea)',
    '[role="textbox"]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
  ].join(',');

  const APP_CONTROL = [EDITABLE, 'select', 'button', '[data-pane-prevent-terminal-focus]'].join(',');

  export function editable(target: EventTarget | null): boolean {
    if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
    return target.closest(EDITABLE) !== null;
  }

  export function focusesEngine(target: EventTarget | null): boolean {
    if (typeof Element === 'undefined' || !(target instanceof Element)) return true;
    return target.closest(APP_CONTROL) === null;
  }

  const PATH_TYPES = ['text/uri-list', 'text/plain'];

  export function carriesPath(transfer: DataTransfer): boolean {
    return PATH_TYPES.some((type) => transfer.types.includes(type));
  }

  export function carriesFiles(transfer: DataTransfer): boolean {
    return transfer.types.includes('Files');
  }

  export function droppedPath(transfer: DataTransfer): string {
    const text = transfer.getData('text/uri-list') || transfer.getData('text/plain') || '';
    const first = text.split(/\r?\n/)[0]?.trim() ?? '';
    if (!first.startsWith('file://')) return first;
    const encoded = first.slice('file://'.length);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
</script>

<script lang="ts">
  import '@xterm/xterm/css/xterm.css';
  import './terminal.css';
  import TerminalExitOverlay from './ExitOverlay.svelte';
  import TerminalSearch from './Search.svelte';
  import TerminalToast from './Toast.svelte';
  import type { Snippet } from 'svelte';
  import type { PaneStyle } from '../appearance/Settings.svelte.js';
  import type { TerminalPane } from './Pane.svelte.js';
  import type { FileDrop } from './fileDrop.js';

  let {
    pane,
    isMac,
    flex = '1 1 0%',
    hidden = false,
    style,
    active = true,
    renaming = false,
    dragging = false,
    overlay,
    dictation,
    files,
    onActivate,
    onFollowMouse,
    onMenu,
    onDragStart,
  }: {
    pane: TerminalPane;
    isMac: boolean;
    flex?: string;
    hidden?: boolean;
    style?: PaneStyle;
    active?: boolean;
    renaming?: boolean;
    dragging?: boolean;
    overlay?: Snippet;
    dictation?: Snippet<[TerminalPane, HTMLElement]>;
    files?: FileDrop;
    onActivate?: (paneId: string, focusEngine: boolean) => void;
    onFollowMouse?: (paneId: string, buttons: number) => void;
    onMenu?: (paneId: string, x: number, y: number) => boolean;
    onDragStart?: (pane: TerminalPane, handle: HTMLElement, event: PointerEvent) => void;
  } = $props();

  let box: HTMLDivElement | null = $state(null);

  const titled = $derived(pane.label !== null || pane.holder !== null || renaming);
  const footed = $derived(overlay === undefined && pane.ending !== null && !pane.endingDismissed);

  $effect(() => {
    const element = box;
    if (element === null) return;
    const stop = pane.watchPlace(element);
    pane.attach(element);
    return () => {
      stop();
      pane.detach(element);
    };
  });

  $effect(() => (files === undefined ? undefined : pane.takeFiles(files)));

  $effect(() => {
    if (!active) return;
    if (pane.paintedAt === null && pane.replayedAt === null) return;
    pane.focus();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={box}
  class="pane"
  class:is-drag-source={dragging}
  class:pane-focus-rim-flash={pane.locating}
  data-pane-id={pane.id}
  data-has-title={titled ? '' : undefined}
  data-has-foot={footed ? '' : undefined}
  role="application"
  aria-label="terminal"
  aria-busy={pane.address !== null && pane.replayedAt === null && pane.refusal === null}
  style:flex
  style:--pane-fill={pane.fill}
  style:--pane-padding-x={pane.paddingX}
  style:--pane-padding-y={pane.paddingY}
  style:display={hidden ? 'none' : undefined}
  style:opacity={style === undefined ? undefined : active ? style.activePaneOpacity : style.inactivePaneOpacity}
  style:transition={style !== undefined && style.opacityTransitionMs > 0 ? `opacity ${style.opacityTransitionMs}ms ease` : undefined}
  onpointerdown={(event) => onActivate?.(pane.id, focusesEngine(event.target))}
  onpointerenter={(event) => onFollowMouse?.(pane.id, event.buttons)}
  oncontextmenu={(event) => {
    if (onMenu?.(pane.id, event.clientX, event.clientY) === true) event.preventDefault();
  }}
  ondragover={(event) => {
    const transfer = event.dataTransfer;
    if (transfer === null || !pane.typable || !(carriesPath(transfer) || (files !== undefined && carriesFiles(transfer)))) return;
    event.preventDefault();
    transfer.dropEffect = 'copy';
  }}
  ondrop={(event) => {
    const transfer = event.dataTransfer;
    if (transfer !== null && pane.typable && files !== undefined && transfer.files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      onActivate?.(pane.id, true);
      void pane.pasteDropped(files([...transfer.files]));
      return;
    }
    const path = transfer === null || !pane.typable ? '' : droppedPath(transfer);
    if (path === '') return;
    event.preventDefault();
    event.stopPropagation();
    // The pane the path lands in is the one it was dropped on, and it takes the keyboard with it.
    // Orca `terminal-drop-pane-resolution.ts:17-29`, `terminal-drop-handler.ts:107-109`.
    onActivate?.(pane.id, true);
    pane.pastePaths([path]);
  }}
>
  {#if onDragStart !== undefined}
    <div class="pane-drag-handle" aria-hidden="true" onpointerdown={(event) => onDragStart(pane, event.currentTarget, event)}></div>
  {/if}

  <TerminalSearch
    search={pane.search}
    open={pane.searching}
    {isMac}
    onClose={() => {
      pane.searching = false;
      pane.focus();
    }}
    onProblem={(problem) => pane.noteProblem(problem)}
  />

  {#if overlay !== undefined}
    {@render overlay()}
  {:else if pane.ending !== null && !pane.endingDismissed}
    {#if pane.watching}
      <TerminalExitOverlay ending={pane.ending} named={pane.label ?? pane.title} onClose={() => pane.closePane()} />
    {:else}
      <TerminalExitOverlay ending={pane.ending} onRestart={() => void pane.restart()} onClose={() => pane.closePane()} />
    {/if}
  {/if}
  {#if dictation !== undefined && box !== null}
    {@render dictation(pane, box)}
  {/if}
  {#if pane.refusal !== null}
    <TerminalToast message={pane.refusal.message} onDismiss={() => pane.dismissRefusal()} />
  {:else if pane.recovering}
    <TerminalToast message="Reconnecting…" />
  {/if}
</div>
