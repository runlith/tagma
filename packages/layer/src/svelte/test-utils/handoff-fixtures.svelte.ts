import { createSubscriber } from 'svelte/reactivity';

import { Service } from '../../key.js';
import { Layer } from '../../Layer.js';
import { Scope } from '../../Scope.js';

export class Search extends Service<{ find(query: string): string }>()('Search', { tier: 'visitor', deferred: true }) {}

export function gatedSearch(): { layer: Layer<never, never>; release(): void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const layer = Layer.load(Search, () =>
    gate.then(() => ({ default: Layer.provide(Search, () => ({ find: (query: string) => `hit:${query}` })) })),
  ) as Layer<never, never>;
  return { layer, release };
}

export const pending: Ledger[] = [];

export function settleAll(answer: string): void {
  for (const ledger of pending) ledger.settle(answer);
}

export class Ledger extends Service<Ledger>()('Ledger', { tier: 'visitor' }) {
  private stored = $state.raw<string | undefined>(undefined);
  private readonly subscribe = createSubscriber(() => undefined);

  // eslint-disable-next-line require-yield
  static *make() {
    const ledger = new Ledger();
    pending.push(ledger);
    return ledger;
  }

  get answer(): string | undefined {
    this.subscribe();
    return this.stored;
  }

  settle(answer: string): void {
    this.stored = answer;
  }
}

export class Teaser extends Service<Teaser>()('Teaser', { tier: 'guest', eager: true }) {
  static *make() {
    return new Teaser(yield* Ledger);
  }

  constructor(private readonly ledger: Ledger) {
    super();
  }

  get answer(): string | undefined {
    return this.ledger.answer;
  }
}

export class Player extends Service<Player>()('Player', { tier: 'user', eager: true }) {
  static *make() {
    const machine = yield* Machine;
    const player = new Player(yield* Ledger);
    const scope = yield* Scope;
    machine.player = player;
    scope.defer(() => {
      machine.player = undefined;
    });
    return player;
  }

  constructor(private readonly ledger: Ledger) {
    super();
  }

  get blocker(): string | undefined {
    return this.ledger.answer === undefined ? 'loading' : undefined;
  }
}

export class Machine extends Service<Machine>()('Machine', { tier: 'app', eager: true }) {
  player = $state<Player | undefined>(undefined);

  readonly blocker = $derived(this.player?.blocker);

  // eslint-disable-next-line require-yield
  static *make() {
    return new Machine();
  }
}
