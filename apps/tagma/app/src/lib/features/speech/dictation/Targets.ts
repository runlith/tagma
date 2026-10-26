import { Service } from '@runlith/layer/key';
import type { Target } from './target.js';

type Placed = { readonly target: Target; readonly fallback: () => boolean };

export class Targets extends Service<Targets>()('DictationTargets', { tier: 'app' }) {
  static make(): Targets {
    return new Targets();
  }

  private readonly placed = new Map<Element, Placed>();

  place(element: Element, target: Target, fallback: () => boolean = () => false): () => void {
    const placed: Placed = { target, fallback };
    this.placed.set(element, placed);
    return () => {
      if (this.placed.get(element) === placed) this.placed.delete(element);
    };
  }

  focused(): Target | null {
    const active = document.activeElement;
    let inner: Element | null = null;
    if (active !== null && active !== document.body) {
      for (const element of this.placed.keys()) {
        if (element.contains(active) && (inner === null || inner.contains(element))) inner = element;
      }
    }
    if (inner !== null) return this.placed.get(inner)!.target;
    for (const placed of this.placed.values()) if (placed.fallback()) return placed.target;
    return null;
  }
}
