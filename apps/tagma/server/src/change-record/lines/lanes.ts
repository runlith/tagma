export type Lane = 'now' | 'later';

type ReadyJob<A> = { readonly lane: Lane; readonly value: A };

export class WorkLanes<A extends object> {
  private readonly pending: Record<Lane, A[]> = { now: [], later: [] };
  constructor(private readonly eligible: (value: A) => boolean) {}
  offer(lane: Lane, value: A): void {
    this.pending[lane].push(value);
  }
  first(background: boolean): ReadyJob<A> | undefined {
    for (const lane of background ? (['now', 'later'] as const) : (['now'] as const)) {
      const value = this.pending[lane].find(this.eligible);
      if (value !== undefined) return { lane, value };
    }
    return undefined;
  }
  remove(value: A): void {
    for (const lane of ['now', 'later'] as const) {
      const at = this.pending[lane].indexOf(value);
      if (at >= 0) this.pending[lane].splice(at, 1);
    }
  }
  drain(): readonly A[] {
    return [...this.pending.now.splice(0), ...this.pending.later.splice(0)];
  }
}
