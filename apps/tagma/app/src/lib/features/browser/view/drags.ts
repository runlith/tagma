const DRAG_PX = 4;

type Press = { readonly id: number; readonly x: number; readonly y: number };

export function followDrags(changed: (dragging: boolean) => void): () => void {
  let press: Press | null = null;
  let pointer = false;
  let native = false;
  let reported = false;
  const report = (): void => {
    const dragging = pointer || native;
    if (dragging === reported) return;
    reported = dragging;
    changed(dragging);
  };
  const release = (): void => {
    press = null;
    pointer = false;
    report();
  };
  const down = (event: PointerEvent): void => {
    if (event.button === 0) press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent): void => {
    if (press === null || event.pointerId !== press.id) return;
    if ((event.buttons & 1) === 0) return release();
    if (pointer || Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
    pointer = true;
    report();
  };
  const up = (event: PointerEvent): void => {
    if (press?.id === event.pointerId) release();
  };
  const lift = (): void => {
    native = true;
    report();
  };
  const land = (): void => {
    native = false;
    report();
  };
  const lost = (): void => {
    native = false;
    release();
  };
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('dragstart', lift, true);
  window.addEventListener('dragend', land, true);
  window.addEventListener('blur', lost);
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    window.removeEventListener('dragstart', lift, true);
    window.removeEventListener('dragend', land, true);
    window.removeEventListener('blur', lost);
  };
}
