import type { HarnessAdapter } from '../contract/service/adapter.js';

export type BuiltinHarness = () => Promise<HarnessAdapter>;

export const BUILTIN_LOADERS: ReadonlyMap<string, BuiltinHarness> = new Map([
  ['codex', async () => (await import('./codex/row.js')).codex],
  ['devin', async () => (await import('./devin/row.js')).devin],
  ['cursor', async () => (await import('./cursor/row.js')).cursor],
  ['opencode', async () => (await import('./opencode/row.js')).opencode],
]);
