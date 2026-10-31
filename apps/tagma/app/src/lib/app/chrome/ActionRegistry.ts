import { type Resolver, Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { type ActionSet, type PaletteAction, PaletteActions } from '$lib/features/workspace/action.js';

export class ActionRegistry extends Service<ActionRegistry>()('ActionRegistry', { tier: 'app' }) {
  static *make() {
    return new ActionRegistry(yield* PaletteActions);
  }

  constructor(private readonly sets: Point<ActionSet>) {
    super();
  }

  of(app: Resolver): readonly PaletteAction[] {
    return this.sets.items
      .flatMap(({ actions }) => (typeof actions === 'function' ? actions(app) : actions))
      .sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
  }
}
