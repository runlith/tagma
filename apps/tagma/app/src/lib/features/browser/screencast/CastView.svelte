<script lang="ts">
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import type { PageId } from '@tagma/server/browser/contract/wire/ids';
  import { Live } from '$lib/wire/Live.js';
  import { Cast } from './Cast.svelte.js';
  import { buttonOf, fractionOf, keyOf, modifiersOf, pictureIn, type Point, wantsCopy, wantsCut } from './input.js';

  let { projectId, page, layout = true }: { projectId: number; page: PageId; layout?: boolean } = $props();

  const LINE_PX = 40;
  const TAP_SLOP_PX = 8;
  const DOUBLE_MS = 400;

  const live = Live.use();
  const opened = () => new Cast(live, projectId, page);
  const cast = opened();

  let area = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let typing = $state<HTMLTextAreaElement>();
  let picking = $state<HTMLInputElement>();

  let clicks = { count: 0, at: 0, x: 0, y: 0 };
  let touch: { id: number; start: Point; last: Point; panned: boolean } | null = null;

  export function type(): void {
    typing?.focus({ preventScroll: true });
  }

  $effect(() => {
    const element = area;
    if (element === undefined) return;
    let watching = false;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const width = Math.min(8192, Math.round(entry.contentRect.width));
      const height = Math.min(8192, Math.round(entry.contentRect.height));
      if (width < 64 || height < 64) return;
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio));
      if (watching) cast.view({ width, height }, scale);
      else {
        watching = true;
        cast.watch({ width, height, scale, layout });
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cast.close();
    };
  });

  $effect(() => {
    const shown = () => (document.visibilityState === 'hidden' ? cast.pause() : cast.resume());
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  });

  $effect(() => {
    const picture = cast.picture;
    const target = canvas;
    if (picture === null || target === undefined) return;
    if (target.width !== picture.bitmap.width) target.width = picture.bitmap.width;
    if (target.height !== picture.bitmap.height) target.height = picture.bitmap.height;
    target.getContext('2d')?.drawImage(picture.bitmap, 0, 0);
  });

  $effect(() => {
    const element = area;
    if (element === undefined) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? element.clientHeight : 1;
      scrolled({ x: event.clientX, y: event.clientY }, event.deltaX * unit, event.deltaY * unit, modifiersOf(event));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });

  const placed = (at: Point, clamped = false): Point | null => {
    const picture = cast.picture;
    if (picture === null || canvas === undefined) return null;
    return fractionOf(at, canvas.getBoundingClientRect(), { width: picture.bitmap.width, height: picture.bitmap.height }, clamped);
  };

  const ratio = (): number => {
    const picture = cast.picture;
    if (picture === null || canvas === undefined) return 1;
    return (
      picture.view.width / pictureIn(canvas.getBoundingClientRect(), { width: picture.bitmap.width, height: picture.bitmap.height }).width
    );
  };

  function scrolled(at: Point, dx: number, dy: number, modifiers: number): void {
    const point = placed(at);
    if (point === null) return;
    const scale = ratio();
    cast.send({ kind: 'wheel', x: point.x, y: point.y, dx: dx * scale, dy: dy * scale, modifiers });
  }

  function clicked(point: Point, button: 'left' | 'middle' | 'right', count: number, modifiers: number): void {
    cast.send({ kind: 'mouse', type: 'move', ...point, button: 'none', clicks: 0, modifiers });
    cast.send({ kind: 'mouse', type: 'down', ...point, button, clicks: count, modifiers });
    cast.send({ kind: 'mouse', type: 'up', ...point, button, clicks: count, modifiers });
  }

  function pressed(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      if (touch === null)
        touch = {
          id: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          last: { x: event.clientX, y: event.clientY },
          panned: false,
        };
      return;
    }
    typing?.focus({ preventScroll: true });
    const point = placed({ x: event.clientX, y: event.clientY });
    if (point === null) return;
    area?.setPointerCapture(event.pointerId);
    const near = event.timeStamp - clicks.at < DOUBLE_MS && Math.hypot(event.clientX - clicks.x, event.clientY - clicks.y) < TAP_SLOP_PX;
    clicks = { count: near ? Math.min(3, clicks.count + 1) : 1, at: event.timeStamp, x: event.clientX, y: event.clientY };
    cast.send({
      kind: 'mouse',
      type: 'down',
      ...point,
      button: buttonOf(event.button),
      clicks: clicks.count,
      modifiers: modifiersOf(event),
    });
  }

  function moved(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      if (touch === null || touch.id !== event.pointerId) return;
      const at = { x: event.clientX, y: event.clientY };
      if (!touch.panned && Math.hypot(at.x - touch.start.x, at.y - touch.start.y) < TAP_SLOP_PX) return;
      touch.panned = true;
      scrolled(touch.start, touch.last.x - at.x, touch.last.y - at.y, 0);
      touch.last = at;
      return;
    }
    const point = placed({ x: event.clientX, y: event.clientY }, event.buttons !== 0);
    if (point === null) return;
    cast.send({ kind: 'mouse', type: 'move', ...point, button: 'none', clicks: 0, modifiers: modifiersOf(event) });
  }

  function released(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      const held = touch;
      if (held === null || held.id !== event.pointerId) return;
      touch = null;
      const point = held.panned ? null : placed(held.start);
      if (point !== null) clicked(point, 'left', 1, 0);
      return;
    }
    const point = placed({ x: event.clientX, y: event.clientY }, true);
    if (point === null) return;
    cast.send({ kind: 'mouse', type: 'up', ...point, button: buttonOf(event.button), clicks: clicks.count, modifiers: modifiersOf(event) });
  }

  function cancelled(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      touch = null;
      return;
    }
    const point = placed({ x: event.clientX, y: event.clientY }, true);
    if (point !== null)
      cast.send({
        kind: 'mouse',
        type: 'up',
        ...point,
        button: buttonOf(event.button < 0 ? 0 : event.button),
        clicks: clicks.count,
        modifiers: 0,
      });
  }

  async function copied(): Promise<boolean> {
    const text = await cast.copy();
    if (text === null || text === '') return false;
    await navigator.clipboard
      .writeText(text)
      .catch((error: unknown) => console.error('[tagma] the copy did not reach the clipboard', error));
    return true;
  }

  function keyed(event: KeyboardEvent): void {
    if (wantsCopy(event) || wantsCut(event)) {
      event.preventDefault();
      void copied().then((held) => {
        if (!held || !wantsCut(event)) return;
        cast.send({ kind: 'key', type: 'down', key: 'Backspace', code: 'Backspace', modifiers: 0 });
        cast.send({ kind: 'key', type: 'up', key: 'Backspace', code: 'Backspace', modifiers: 0 });
      });
      return;
    }
    const sent = keyOf(event, 'down');
    if (sent === null) return;
    event.preventDefault();
    cast.send(sent);
  }

  function lifted(event: KeyboardEvent): void {
    const sent = keyOf(event, 'up');
    if (sent !== null) cast.send(sent);
  }

  function key(name: 'Enter' | 'Backspace' | 'Delete'): void {
    cast.send({ kind: 'key', type: 'down', key: name, code: name, modifiers: 0 });
    cast.send({ kind: 'key', type: 'up', key: name, code: name, modifiers: 0 });
  }

  function inserting(event: InputEvent): void {
    if (event.isComposing) return;
    if (event.inputType === 'insertText' && event.data !== null) cast.send({ kind: 'text', text: event.data });
    else if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') key('Enter');
    else if (event.inputType === 'deleteContentBackward') key('Backspace');
    else if (event.inputType === 'deleteContentForward') key('Delete');
    else return;
    event.preventDefault();
  }

  function composed(event: CompositionEvent): void {
    if (event.data !== '') cast.send({ kind: 'text', text: event.data });
    if (typing !== undefined) typing.value = '';
  }

  function pasted(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text !== '') cast.send({ kind: 'text', text });
  }

  function chosen(): void {
    const list = picking?.files;
    void cast.choose(list === null || list === undefined ? [] : [...list]);
    if (picking !== undefined) picking.value = '';
  }
</script>

<div
  bind:this={area}
  class="absolute inset-0 touch-none overflow-hidden bg-sunken select-none"
  role="application"
  aria-label="Page"
  onpointerdown={pressed}
  onpointermove={moved}
  onpointerup={released}
  onpointercancel={cancelled}
  onmousedown={(event) => event.preventDefault()}
  oncontextmenu={(event) => event.preventDefault()}
>
  <canvas bind:this={canvas} class="absolute inset-0 size-full object-contain"></canvas>
  <textarea
    bind:this={typing}
    class="absolute top-0 left-0 size-px opacity-0"
    aria-label="Type into the page"
    autocapitalize="off"
    autocomplete="off"
    spellcheck="false"
    onkeydown={keyed}
    onkeyup={lifted}
    onbeforeinput={inserting}
    oncompositionend={composed}
    onpaste={pasted}></textarea>
  {#if cast.picture === null}
    <div class="absolute inset-0 grid place-items-center px-6 text-center text-small text-muted-foreground">
      {cast.failure ?? 'Connecting to the page…'}
    </div>
  {:else if cast.failure !== null}
    <div class="absolute inset-x-0 top-0 bg-raised px-3 py-1.5 text-small text-destructive shadow-raised">{cast.failure}</div>
  {/if}
  {#if cast.chooser !== null}
    <div
      class="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-raised px-3 py-2 text-small shadow-float"
      role="toolbar"
      tabindex="-1"
      onpointerdown={(event) => event.stopPropagation()}
    >
      <Paperclip class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1">The page asks for {cast.chooser.multiple ? 'files' : 'a file'}.</span>
      <button type="button" class="rounded-md px-2 py-1 text-muted-foreground hover:bg-hover" onclick={() => void cast.choose([])}
        >Cancel</button
      >
      <button type="button" class="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground" onclick={() => picking?.click()}
        >Choose…</button
      >
      <input bind:this={picking} type="file" class="hidden" multiple={cast.chooser.multiple} onchange={chosen} />
    </div>
  {/if}
</div>
