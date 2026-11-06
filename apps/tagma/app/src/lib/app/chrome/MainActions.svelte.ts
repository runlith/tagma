import type { DesktopKeys as Bridge, OwnedAction } from '@tagma/desktop/bridge';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { type Action, Actions } from '$lib/features/workspace/action.js';
import { DesktopKeys } from '$lib/shared/desktop/DesktopKeys.js';

export class MainActions extends Service<MainActions>()('MainActions', { tier: 'app', eager: true }) {
  static *make() {
    const main = new MainActions(yield* DesktopKeys.optional());
    (yield* Scope).defer(
      (yield* Actions).register('main', { id: 'main', area: 'Window', actions: () => main.actions, settled: () => main.heard }),
    );
    return main;
  }

  private owned = $state.raw<readonly OwnedAction[]>([]);
  private heard = $state(false);

  constructor(private readonly desktop: Bridge | undefined) {
    super();
    const owned = desktop?.owned;
    if (owned === undefined || desktop?.perform === undefined) this.heard = true;
    else
      void owned().then(
        (actions) => {
          this.owned = actions;
          this.heard = true;
        },
        () => (this.heard = true),
      );
  }

  private get actions(): readonly Action[] {
    return this.owned.map((owned) => ({
      id: owned.id,
      title: owned.title,
      keys: owned.keys,
      tabKeys: [],
      run: () => this.desktop?.perform?.(owned.id),
    }));
  }
}
