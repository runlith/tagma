import type { Graph } from './Graph.js';
import type { AnyKeyClass, Key, Tier } from './key.js';

export type ScopeKey = Key<'Scope', Scope>;

export class ScopeAbort extends Error {
  constructor(readonly scope: Scope) {
    super(`Scope "${scope.name}" closed`);
    this.name = 'ScopeAbort';
  }
}

export class FinalizerError extends Error {
  constructor(
    readonly scope: string,
    cause: unknown,
  ) {
    super(`A finalizer of scope "${scope}" failed`, { cause });
    this.name = 'FinalizerError';
  }
}

export type Finalizer = () => void | Promise<void>;

export class Scope {
  readonly instances = new Map<AnyKeyClass, object>();
  readonly building = new Set<AnyKeyClass>();
  readonly finalizers: Finalizer[] = [];
  readonly controller = new AbortController();
  closed = false;
  graph: Graph | undefined;

  private constructor(
    readonly name: string,
    readonly tier: Tier | undefined,
    readonly parent?: Scope,
    readonly kind?: Tier,
  ) {}

  static make(name = 'app'): Scope {
    return new Scope(name, 'app');
  }

  static *[Symbol.iterator](): Iterator<ScopeKey, Scope, unknown> {
    return (yield Scope as unknown as ScopeKey) as Scope;
  }

  hosts(tier: Tier): boolean {
    return this.tier !== undefined && (this.tier === tier || this.kind === tier);
  }

  owner(tier: Tier): Scope | undefined {
    for (let current: Scope | undefined = this; current; current = current.parent) {
      if (current.hosts(tier)) return current;
    }
    return undefined;
  }

  isAncestorOf(scope: Scope): boolean {
    for (let current = scope.parent; current; current = current.parent) {
      if (current === this) return true;
    }
    return false;
  }

  child(name: string): Scope {
    return this.link(new Scope(name, undefined, this));
  }

  rung(place: string, tier: Tier, kind?: Tier): Scope {
    return this.link(new Scope(place, tier, this, kind));
  }

  private link(child: Scope): Scope {
    this.assertOpen();
    child.graph = this.graph;
    const release: Finalizer = () => child.close();
    this.finalizers.push(release);
    child.finalizers.push(() => {
      const index = this.finalizers.indexOf(release);
      if (index !== -1) this.finalizers.splice(index, 1);
    });
    return child;
  }

  get home(): Scope {
    return this.tier !== undefined || !this.parent ? this : this.parent.home;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  defer(finalizer: Finalizer): void {
    if (this.closed) {
      void this.invoke(finalizer);
      return;
    }
    this.finalizers.push(finalizer);
  }

  release(finalizer: Finalizer): void {
    const index = this.finalizers.indexOf(finalizer);
    if (index !== -1) this.finalizers.splice(index, 1);
  }

  assertOpen(): void {
    if (this.closed) throw new ScopeAbort(this);
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.controller.abort(new ScopeAbort(this));
    const finalizers = this.finalizers.splice(0).reverse();
    this.instances.clear();
    return Promise.all(finalizers.map((finalizer) => this.invoke(finalizer))).then(() => undefined);
  }

  private invoke(finalizer: Finalizer): Promise<void> {
    try {
      return Promise.resolve(finalizer()).catch((error: unknown) => this.report(error));
    } catch (error) {
      this.report(error);
      return Promise.resolve();
    }
  }

  private report(error: unknown): void {
    const failure = new FinalizerError(this.name, error);
    if (this.graph) this.graph.report(failure);
    else console.error(failure.message, error);
  }

  await<T>(promise: Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ScopeAbort(this));
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new ScopeAbort(this));
      this.signal.addEventListener('abort', abort, { once: true });
      promise.then(
        (value) => {
          this.signal.removeEventListener('abort', abort);
          if (this.closed) reject(new ScopeAbort(this));
          else resolve(value);
        },
        (error: unknown) => {
          this.signal.removeEventListener('abort', abort);
          reject(this.closed ? new ScopeAbort(this) : error);
        },
      );
    });
  }

  run(command: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.closed) return Promise.resolve();
    return command(this.signal).catch((error: unknown) => {
      if (error instanceof ScopeAbort) return;
      throw error;
    });
  }
}
