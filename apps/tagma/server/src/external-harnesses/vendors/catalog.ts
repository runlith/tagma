import type { HarnessAdapter } from '../contract/service/adapter.js';

export type BuiltinHarness = () => Promise<HarnessAdapter>;

export const BUILTIN_LOADERS: ReadonlyMap<string, BuiltinHarness> = new Map([]);
