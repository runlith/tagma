import { uuidv7 } from 'uuidv7';

export type RunningWork = {
  readonly abort: AbortController;
  readonly promise: Promise<unknown>;
  readonly heartbeat?: ReturnType<typeof setInterval>;
};

export type LeaseRuntimeOptions = {
  ownerIdPrefix: string;
  ownerId?: string;
};

export class LeaseRuntime<W extends RunningWork> {
  readonly ownerId: string;
  private readonly running = new Map<string, W>();
  private isDisposed = false;

  constructor(options: LeaseRuntimeOptions) {
    this.ownerId = options.ownerId ?? `${options.ownerIdPrefix}-${uuidv7()}`;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  add(id: string, work: W): void {
    if (this.running.has(id)) throw new Error(`Work is already tracked: ${id}`);
    this.running.set(id, work);
  }

  get(id: string): W | undefined {
    return this.running.get(id);
  }

  delete(id: string): boolean {
    return this.running.delete(id);
  }

  has(id: string): boolean {
    return this.running.has(id);
  }

  size(): number {
    return this.running.size;
  }

  values(): IterableIterator<W> {
    return this.running.values();
  }

  async dispose(reason: string): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;
    const works = [...this.running.values()];
    for (const work of works) {
      work.abort.abort(new Error(reason));
      if (work.heartbeat) clearInterval(work.heartbeat);
    }
    await Promise.allSettled(works.map((work) => work.promise));
    this.running.clear();
  }
}
