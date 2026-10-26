import type { SurfaceDeclaration, SurfacesModule } from '$lib/features/workspace/surface.js';

const modules = import.meta.glob<SurfacesModule>('../features/*/surfaces.ts', { eager: true });

export const DECLARED_SURFACES: readonly SurfaceDeclaration[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path]?.surfaces ?? []);
