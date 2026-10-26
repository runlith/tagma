import type { SwipeDirection } from '@tagma/desktop/bridge';

const SLOP = 8;
const STEEPNESS = 2;
const SLACK = 1.25;
export const REACH = 140;

type Gesture =
  | { readonly kind: 'idle' }
  | { readonly kind: 'deciding'; readonly x: number; readonly y: number }
  | { readonly kind: 'passed' }
  | { readonly kind: 'pulling'; readonly direction: SwipeDirection; readonly travel: number };

export type Pull = { readonly direction: SwipeDirection; readonly progress: number };

export class Swipe {
  #gesture = $state.raw<Gesture>({ kind: 'idle' });

  readonly pull: Pull | null = $derived(
    this.#gesture.kind === 'pulling' ? { direction: this.#gesture.direction, progress: this.#gesture.travel / REACH } : null,
  );

  constructor(private readonly open: (direction: SwipeDirection) => boolean) {}

  began(): void {
    this.#gesture = { kind: 'deciding', x: 0, y: 0 };
  }

  moved(dx: number, dy: number, taken: (direction: SwipeDirection) => boolean): void {
    const gesture = this.#gesture;
    if (gesture.kind === 'pulling') {
      const travel = gesture.travel + (gesture.direction === 'back' ? -dx : dx);
      this.#gesture = { ...gesture, travel: Math.min(Math.max(travel, 0), REACH * SLACK) };
      return;
    }
    if (gesture.kind !== 'deciding') return;
    if (dx !== 0 && taken(dx < 0 ? 'back' : 'forward')) {
      this.#gesture = { kind: 'passed' };
      return;
    }
    const x = gesture.x + dx;
    const y = gesture.y + dy;
    if (Math.hypot(x, y) < SLOP) {
      this.#gesture = { kind: 'deciding', x, y };
      return;
    }
    const direction = x < 0 ? 'back' : 'forward';
    this.#gesture =
      Math.abs(x) >= Math.abs(y) * STEEPNESS && this.open(direction)
        ? { kind: 'pulling', direction, travel: Math.abs(x) }
        : { kind: 'passed' };
  }

  ended(): SwipeDirection | null {
    const gesture = this.#gesture;
    this.#gesture = { kind: 'idle' };
    return gesture.kind === 'pulling' && gesture.travel >= REACH ? gesture.direction : null;
  }

  cancelled(): void {
    this.#gesture = { kind: 'idle' };
  }
}
