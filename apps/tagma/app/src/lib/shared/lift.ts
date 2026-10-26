export type Point = { readonly x: number; readonly y: number };

export type Lifting = {
  readonly distance?: (from: Point, at: Point) => number;
  readonly threshold: number;
  readonly lift: (at: Point, event: PointerEvent) => boolean;
  readonly move: (at: Point) => void;
  readonly drop: (at: Point) => void;
  readonly cancel: () => void;
};

const apart = (from: Point, at: Point): number => Math.abs(at.x - from.x) + Math.abs(at.y - from.y);

export function lift(press: PointerEvent, lifting: Lifting): () => void {
  const from = { x: press.clientX, y: press.clientY };
  let lifted = false;
  const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });
  const move = (event: PointerEvent): void => {
    if (event.pointerId !== press.pointerId) return;
    const at = pointOf(event);
    if (!lifted) {
      if ((lifting.distance ?? apart)(from, at) < lifting.threshold) return;
      if (!lifting.lift(at, event)) return stop();
      lifted = true;
      window.getSelection()?.removeAllRanges();
      document.body.classList.add('select-none');
    }
    lifting.move(at);
  };
  const up = (event: PointerEvent): void => {
    if (event.pointerId !== press.pointerId) return;
    const was = lifted;
    stop();
    if (!was) return;
    swallowClick();
    lifting.drop(pointOf(event));
  };
  const cancel = (): void => {
    const was = lifted;
    stop();
    if (was) lifting.cancel();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !lifted) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };
  const stop = (): void => {
    if (lifted) document.body.classList.remove('select-none');
    lifted = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', key, true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key, true);
  return cancel;
}

function swallowClick(): void {
  const click = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', click, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', click, { capture: true }), 0);
}
