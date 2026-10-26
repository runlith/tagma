import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import type { PaletteAction } from '$lib/features/workspace/action.js';
import { type SurfaceDeclaration, SurfaceRegistry } from '$lib/features/workspace/surface.js';

export class PluginActions extends Service<PluginActions>()('PluginActions', { tier: 'app' }) {
  static *make() {
    return new PluginActions(yield* SurfaceRegistry);
  }

  actions = $state.raw<readonly PaletteAction[]>([]);
  private shown: (() => void) | null = null;

  constructor(private readonly surfaces: SurfaceRegistry) {
    super();
  }

  addAll(added: readonly PaletteAction[]): () => void {
    untrack(() => {
      this.actions = [...this.actions, ...added];
    });
    const own = new Set(added);
    return () => {
      untrack(() => {
        this.actions = this.actions.filter((held) => !own.has(held));
      });
    };
  }

  add(action: PaletteAction): () => void {
    untrack(() => {
      this.actions = [...this.actions, action];
    });
    return () => {
      untrack(() => {
        this.actions = this.actions.filter((held) => held !== action);
      });
    };
  }

  show(sections: readonly SurfaceDeclaration[], actions: readonly PaletteAction[]): () => void {
    this.shown?.();
    const releases = [...sections.map((section) => this.surfaces.register(section)), this.addAll(actions)];
    const release = (): void => {
      if (this.shown !== release) return;
      this.shown = null;
      for (const one of releases) one();
    };
    this.shown = release;
    return release;
  }
}
