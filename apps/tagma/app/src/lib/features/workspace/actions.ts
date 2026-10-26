import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { ActionsModule } from '$lib/features/workspace/action.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { SurfaceRegistry } from './surface.js';

export const actions: ActionsModule['actions'] = (app) =>
  app
    .resolve(SurfaceRegistry)
    .declared.filter((entry) => entry.nested !== true)
    .map((entry) => ({
      id: `go.${entry.surface}`,
      order: 70,
      title: `Go to ${entry.label}`,
      keywords: ['open', 'navigate', 'section'],
      icon: entry.icon,
      available: (env) => env.project !== null,
      run: (env) => shellActs(env.resolve(ShellOps), env.resolve(Notices)).revealSurface(entry.surface),
    }));
