import { Service } from '../../key.js';
import { Scope } from '../../Scope.js';
import { Screen } from '../screen.svelte.js';

export class Config extends Service<Config>()('Config', { tier: 'app' }) {
  constructor(readonly brand: string) {
    super();
  }
}

export class PanelScreen extends Screen<PanelScreen, { slot: string }>()('PanelScreen', { tier: 'app' }) {
  static override *make(options: { slot: string }) {
    return new PanelScreen(yield* Config, options.slot);
  }
  constructor(
    readonly config: Config,
    readonly slot: string,
  ) {
    super();
  }
}

export class MakelessScreen extends Screen<MakelessScreen>()('MakelessScreen', { tier: 'app' }) {}

export class ScopedScreen extends Screen<ScopedScreen>()('ScopedScreen', { tier: 'app' }) {
  static override *make() {
    return new ScopedScreen(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}

export const disposed: string[] = [];

export class FailingScreen extends Screen<FailingScreen>()('FailingScreen', { tier: 'app' }) {
  static override *make() {
    const scope = yield* Scope;
    scope.defer(() => void disposed.push('disposed'));
    throw new Error('screen make failed');
  }
}

export const counter = $state({ value: 0 });

export class TickerScreen extends Screen<TickerScreen>()('TickerScreen', { tier: 'app' }) {
  static override make() {
    return new TickerScreen();
  }
  readonly seen: number[] = [];
  constructor() {
    super();
    $effect(() => {
      this.seen.push(counter.value);
    });
  }
}
