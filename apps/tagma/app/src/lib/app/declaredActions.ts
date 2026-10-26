import type { ActionsModule } from '$lib/features/workspace/action.js';
import { ActionRegistry } from './chrome/ActionRegistry.js';

const modules = import.meta.glob<ActionsModule>(['../features/*/actions.ts', './*/actions.ts'], { eager: true });

export const DECLARED_ACTIONS = new ActionRegistry(
  Object.keys(modules)
    .sort()
    .flatMap((path) => (modules[path] === undefined ? [] : [modules[path]])),
);
