import { Clock, type Context, Effect, Exit, type Tracer } from 'effect';
import type { PhaseEvent } from './asks.js';

type Open = { readonly id: number; readonly span: Tracer.Span; readonly name: string; readonly since: number };

export class PhaseMirror {
  private readonly open = new Map<number, Open>();

  constructor(
    private readonly context: Context.Context<never>,
    private readonly parent: Tracer.Span,
    readonly about: number,
  ) {}

  take(event: PhaseEvent): void {
    if (event.about !== this.about) return;
    if (event.phase === 'open') {
      const parent = event.parent === null ? this.parent : (this.open.get(event.parent)?.span ?? this.parent);
      const span = Effect.runSyncWith(this.context)(Effect.makeSpan(event.name, { parent }));
      this.open.set(event.id, { id: event.id, span, name: event.name, since: Date.now() });
      return;
    }
    const open = this.open.get(event.id);
    if (open === undefined) return;
    this.open.delete(event.id);
    for (const [key, value] of Object.entries(event.attributes)) open.span.attribute(key, value);
    this.end(open.span, event.ended === 'ok' ? Exit.void : event.ended === 'interrupted' ? Exit.interrupt() : Exit.fail(event.ended));
  }

  innermost(): Open | undefined {
    let last: Open | undefined;
    for (const open of this.open.values()) last = open;
    return last;
  }

  close(): void {
    for (const open of this.open.values()) this.end(open.span, Exit.interrupt());
    this.open.clear();
  }

  private end(span: Tracer.Span, exit: Exit.Exit<unknown, unknown>): void {
    span.end(Effect.runSyncWith(this.context)(Clock.currentTimeNanos), exit);
  }
}
