import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { type ActionSet, type PaletteAction, PaletteActions } from '$lib/features/workspace/action.js';
import { type SurfaceDeclaration, Surfaces } from '$lib/features/workspace/surface.js';

const SECTIONS = 'plugin-views:sections';

export class PluginActions extends Service<PluginActions>()('PluginActions', { tier: 'app' }) {
  static *make() {
    return new PluginActions(yield* Surfaces, yield* PaletteActions);
  }

  private shown: (() => void) | null = null;

  constructor(
    private readonly surfaces: Point<SurfaceDeclaration>,
    private readonly actions: Point<ActionSet>,
  ) {
    super();
  }

  show(sections: readonly SurfaceDeclaration[], actions: readonly PaletteAction[]): () => void {
    this.shown?.();
    const releases = [this.surfaces.register(SECTIONS, ...sections), this.actions.register(SECTIONS, { id: SECTIONS, actions })];
    const release = (): void => {
      if (this.shown !== release) return;
      this.shown = null;
      for (const one of releases) one();
    };
    this.shown = release;
    return release;
  }
}
