import { Service } from './key.js';
import type { AnyRung, RungInput } from './Rung.js';
import type { Scope } from './Scope.js';

export class Handoff extends Service<Handoff>()('Handoff', { tier: 'app' }) {
  constructor(readonly ready: <R extends AnyRung>(rung: R, input: RungInput<R>) => Promise<void>) {
    super();
  }

  private readonly leaving = new Set<(rung: string) => void>();
  private readonly closing = new Set<(scope: Scope) => void>();

  onLeave(leave: (rung: string) => void): () => void {
    this.leaving.add(leave);
    return () => void this.leaving.delete(leave);
  }

  onClosed(closed: (scope: Scope) => void): () => void {
    this.closing.add(closed);
    return () => void this.closing.delete(closed);
  }

  leave(rung: string): void {
    for (const leave of this.leaving) leave(rung);
  }

  closed(scope: Scope): void {
    for (const closed of this.closing) closed(scope);
  }
}
