import type { PanesModule } from '$lib/shared/panes/pane.js';
import { PaneRegistry } from './panes/PaneRegistry.js';

const modules = import.meta.glob<PanesModule>('../features/*/panes.ts', { eager: true });

export const DECLARED_PANES = new PaneRegistry(
  Object.keys(modules)
    .sort()
    .flatMap((path) => modules[path]?.panes ?? []),
);
