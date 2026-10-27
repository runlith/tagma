import type { Point } from '@runlith/primitives/place';

export class ContextAim {
  at = $state<Point | null>(null);

  aim(event: MouseEvent): void {
    event.preventDefault();
    this.at = { x: event.clientX, y: event.clientY };
  }

  get anchor(): Point | null {
    return this.at;
  }

  clear(): void {
    this.at = null;
  }
}
