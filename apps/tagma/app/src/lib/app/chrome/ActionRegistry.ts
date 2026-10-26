import { type Resolver, Service } from '@runlith/layer/key';
import type { ActionsModule, PaletteAction } from '$lib/features/workspace/action.js';

export class ActionRegistry extends Service<ActionRegistry>()('ActionRegistry', { tier: 'app' }) {
  constructor(private readonly modules: readonly ActionsModule[]) {
    super();
  }

  of(app: Resolver): readonly PaletteAction[] {
    return this.modules
      .flatMap(({ actions }) => (typeof actions === 'function' ? actions(app) : actions))
      .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
  }
}
