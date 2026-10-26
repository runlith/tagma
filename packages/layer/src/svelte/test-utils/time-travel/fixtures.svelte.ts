import { Service } from '../../../key.js';
import { Layer } from '../../../Layer.js';
import { Scope } from '../../../Scope.js';

export interface EnginePort {
  find(query: string): string;
}

export class Engine extends Service<EnginePort>()('Engine', { tier: 'visitor', deferred: true }) {}
export class SecondEngine extends Service<EnginePort>()('SecondEngine', { tier: 'visitor', deferred: true }) {}

export interface Gate {
  readonly layer: Layer<never, never>;
  release(): void;
  fail(error: Error): void;
}

export function gatedEngine(key: typeof Engine | typeof SecondEngine = Engine): Gate {
  let release = (): void => undefined;
  let fail: (error: Error) => void = () => undefined;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const layer = Layer.load(key, () =>
    gate.then(() => ({ default: Layer.provide(key, () => ({ find: (query: string) => `hit:${query}` })) })),
  ) as Layer<never, never>;
  return { layer, release, fail };
}

export class World extends Service<World>()('World', { tier: 'app' }) {
  static make() {
    return new World();
  }

  a = $state<number | undefined>(undefined);
  b = $state<number | undefined>(undefined);
  c = $state<number | undefined>(undefined);
  readonly ab = $derived(this.a === undefined ? undefined : `${this.a}/${this.b}`);
  readonly resource = $derived(this.a === undefined ? undefined : { id: this.a });
  cancelled = 0;
}

export type Run = [number | undefined, number | undefined];

export class Probe extends Service<Probe>()('Probe', { tier: 'user', eager: true }) {
  static *make() {
    const scope = yield* Scope;
    const probe = new Probe(yield* World);
    scope.defer(() => {
      probe.runsAtClose = probe.runs.length;
    });
    return probe;
  }

  readonly runs: Run[] = [];
  runsAtClose: number | undefined = undefined;

  constructor(private readonly world: World) {
    super();
    $effect(() => {
      this.runs.push([this.world.a, this.world.b]);
    });
  }
}

export class ProbeLateDependency extends Service<ProbeLateDependency>()('ProbeLateDependency', { tier: 'user', eager: true }) {
  static *make() {
    return new ProbeLateDependency(yield* World);
  }

  readonly runs: Run[] = [];

  constructor(private readonly world: World) {
    super();
    $effect(() => {
      const b = this.world.b;
      if (b === undefined) {
        this.runs.push([undefined, b]);
        return;
      }
      this.runs.push([this.world.a, b]);
    });
  }
}

export class ProbeContinuation extends Service<ProbeContinuation>()('ProbeContinuation', { tier: 'user', eager: true }) {
  static *make() {
    return new ProbeContinuation(yield* World);
  }

  readonly runs: Run[] = [];

  constructor(private readonly world: World) {
    super();
    $effect(() => {
      this.runs.push([this.world.c, this.world.b]);
    });
  }
}

export class ProbeGuard extends Service<ProbeGuard>()('ProbeGuard', { tier: 'user', eager: true }) {
  static *make() {
    return new ProbeGuard(yield* World);
  }

  constructor(private readonly world: World) {
    super();
    $effect(() => {
      const resource = this.world.resource;
      if (!resource) return;
      return () => {
        this.world.cancelled += 1;
      };
    });
  }
}
