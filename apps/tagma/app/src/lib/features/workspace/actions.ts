import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { type Action, Actions } from '$lib/features/workspace/action.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { SurfaceRegistry } from './surface.js';

const goTo = (surfaces: SurfaceRegistry): readonly Action[] =>
  surfaces.declared
    .filter((entry) => entry.nested !== true)
    .map((entry) => ({
      id: `go.${entry.surface}`,
      order: 70,
      title: `Go to ${entry.label}`,
      keywords: ['open', 'navigate', 'section'],
      icon: entry.icon,
      available: (env) => env.project !== null,
      run: (env) => shellActs(env.resolve(ShellOps), env.resolve(Notices)).revealSurface(entry.surface),
    }));

export class SurfaceActions extends Service<SurfaceActions>()('SurfaceActions', { tier: 'app', eager: true }) {
  static *make() {
    const surfaces = yield* SurfaceRegistry;
    (yield* Scope).defer((yield* Actions).register('workspace', { id: 'workspace', area: 'Navigation', actions: () => goTo(surfaces) }));
    return new SurfaceActions();
  }
}
