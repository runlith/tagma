<script lang="ts">
  import type { Snippet } from 'svelte';

  let { width, actions, onHold, children }: { width: number; actions: Snippet<[() => void]>; onHold?: () => void; children: Snippet } =
    $props();

  const DECIDE_PX = 8;
  const HOLD_MS = 450;

  let offset = $state(0);
  let open = $state(false);
  let from: { x: number; y: number; base: number; at: number } | null = null;
  let sideways: boolean | null = null;
  let moved = false;
  let dragging = $state(false);

  function down(event: PointerEvent): void {
    if (event.pointerType === 'mouse') return;
    from = { x: event.clientX, y: event.clientY, base: open ? -width : 0, at: event.timeStamp };
    sideways = null;
    moved = false;
  }

  function move(event: PointerEvent): void {
    if (from === null) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (sideways === null) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return;
      sideways = Math.abs(dx) > Math.abs(dy);
      if (!sideways) {
        from = null;
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      dragging = true;
    }
    moved = true;
    offset = Math.min(0, Math.max(-width * 1.25, from.base + dx));
  }

  function up(event: PointerEvent): void {
    if (from === null) return;
    const held = sideways === null && !open && event.timeStamp - from.at >= HOLD_MS;
    from = null;
    dragging = false;
    if (held && onHold !== undefined) {
      moved = true;
      onHold();
    } else if (sideways) {
      open = offset < -width / 2;
      offset = open ? -width : 0;
    }
  }

  function click(event: MouseEvent): void {
    if (moved || open) {
      event.preventDefault();
      event.stopPropagation();
      if (!moved) close();
    }
    moved = false;
  }

  function close(): void {
    open = false;
    offset = 0;
  }
</script>

<div class="relative overflow-hidden">
  <div class="absolute inset-y-0 right-0 flex" style:width={`${width}px`} aria-hidden={!open}>
    {@render actions(close)}
  </div>
  <div
    class={[
      'relative touch-pan-y bg-background',
      onHold !== undefined && 'select-none',
      !dragging && 'transition-transform duration-200 ease-out',
    ]}
    style:transform={offset === 0 ? undefined : `translateX(${offset}px)`}
    role="presentation"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onclickcapture={click}
    oncontextmenu={(event) => {
      if (onHold !== undefined) event.preventDefault();
    }}
    style:-webkit-touch-callout={onHold === undefined ? undefined : 'none'}
  >
    {@render children()}
  </div>
</div>
