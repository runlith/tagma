import type { LinksModule } from '$lib/features/opening/Link.js';
import { LinkRegistry } from '$lib/features/opening/LinkRegistry.js';

const modules = import.meta.glob<LinksModule>('../../features/*/links.ts', { eager: true });

export const DECLARED_LINKS = new LinkRegistry(
  Object.keys(modules)
    .sort()
    .flatMap((path) => (modules[path] === undefined ? [] : [modules[path]])),
);
