import { join } from 'node:path';
import { ADAPTERS } from '../installation/contract/wire/layout.js';
import type { AdapterEntry } from '@runlith/tagma/adapter/loader';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { AdapterPlaces, AdapterSource } from '../providers/contract/service/registry.js';
import { HOST_MODULES } from './hostModules.generated.js';

export const adapterPlaces = (home: string | null): AdapterPlaces['Service'] => ({
  machine: home === null ? null : join(home, ADAPTERS),
  host: HOST_MODULES,
});

const builtin = (id: string, load: () => Promise<AdapterEntry>): AdapterSource => ({ id, origin: 'builtin', version: null, load });

export const BUILTIN_ADAPTERS: readonly AdapterSource[] = [
  builtin('anthropic', () => import('@runlith/adapter-anthropic/adapter')),
  builtin('openai', () => import('@runlith/adapter-openai/adapter')),
  builtin('cursor', () => import('@runlith/adapter-cursor/adapter')),
  builtin('xai', () => import('@runlith/adapter-xai/adapter')),
  builtin('muse', () => import('@runlith/adapter-muse/adapter')),
  builtin('devin', () => import('@runlith/adapter-devin/adapter')),
  builtin('opencode-go', () => import('@runlith/adapter-opencode-go/adapter')),
  builtin('opencode', () => import('@runlith/adapter-opencode/adapter')),
  builtin('stepfun', () => import('@runlith/adapter-stepfun/adapter')),
  builtin('deepseek', () => import('@runlith/adapter-deepseek/adapter')),
  builtin('openrouter', () => import('@runlith/adapter-openrouter/adapter')),
  builtin('openai-compatible', () => import('@runlith/adapter-openai-compatible/adapter')),
];

export const BUILTIN_HARNESS_PROVIDERS: ReadonlyMap<string, () => Promise<HarnessProvider>> = new Map([
  ['grok', async () => (await import('@runlith/adapter-xai/harness')).grok],
]);
