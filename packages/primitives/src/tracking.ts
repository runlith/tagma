type Move = { count: number; observer: IntersectionObserver | undefined };

export class Tracking {
  private readonly sized = new Map<Element, number>();
  private readonly moving = new Map<Element, Move>();
  private sizes: ResizeObserver | undefined;
  private listening = false;

  constructor(private readonly changed: () => void) {}

  watch(element: Element): () => void {
    const count = (this.sized.get(element) ?? 0) + 1;
    this.sized.set(element, count);
    if (count === 1 && typeof ResizeObserver !== 'undefined') {
      this.sizes ??= new ResizeObserver(() => this.changed());
      this.sizes.observe(element);
    }
    this.listen();

    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const left = (this.sized.get(element) ?? 1) - 1;
      if (left > 0) this.sized.set(element, left);
      else {
        this.sized.delete(element);
        this.sizes?.unobserve(element);
      }
      this.quiet();
    };
  }

  follow(anchor: Element): () => void {
    const unwatch = this.watch(anchor);
    const move = this.moving.get(anchor) ?? { count: 0, observer: undefined };
    move.count += 1;
    if (move.count === 1) {
      this.moving.set(anchor, move);
      this.arm(anchor, move, 1);
    }

    let held = true;
    return () => {
      if (!held) return;
      held = false;
      move.count -= 1;
      if (move.count === 0) {
        move.observer?.disconnect();
        this.moving.delete(anchor);
      }
      unwatch();
    };
  }

  private arm(anchor: Element, move: Move, threshold: number): void {
    move.observer?.disconnect();
    move.observer = undefined;
    if (typeof IntersectionObserver === 'undefined') return;
    const box = anchor.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const root = document.documentElement;
    const margin = [box.top, root.clientWidth - box.right, root.clientHeight - box.bottom, box.left]
      .map((inset) => `${-Math.floor(inset)}px`)
      .join(' ');
    let first = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry?.intersectionRatio ?? 0;
        if (first) {
          first = false;
          if (ratio > 0 && ratio !== threshold) this.arm(anchor, move, ratio);
          return;
        }
        this.changed();
        if (this.moving.get(anchor) === move) this.arm(anchor, move, 1);
      },
      { rootMargin: margin, threshold },
    );
    move.observer = observer;
    observer.observe(anchor);
  }

  private readonly signal = (): void => this.changed();

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener('scroll', this.signal, { capture: true, passive: true });
    window.addEventListener('resize', this.signal, { passive: true });
  }

  private quiet(): void {
    if (!this.listening || this.sized.size > 0) return;
    this.listening = false;
    document.removeEventListener('scroll', this.signal, { capture: true });
    window.removeEventListener('resize', this.signal);
    this.sizes?.disconnect();
    this.sizes = undefined;
  }
}
