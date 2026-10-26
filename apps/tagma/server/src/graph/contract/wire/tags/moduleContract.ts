import type { ContractId } from './behaviour.js';

export const MODULE: ContractId = 'core/module';

export const MODULE_SLOTS = ['id', 'entries', 'order'] as const;
export type ModuleSlot = (typeof MODULE_SLOTS)[number];

export const IMPORTS = 'imports';

export const IMPORTS_TESTS = 'imports-tests';

export const RELATION_EDGES: readonly string[] = [IMPORTS, IMPORTS_TESTS];
