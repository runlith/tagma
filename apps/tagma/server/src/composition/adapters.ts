import { join } from 'node:path';
import { ADAPTERS, CLI_ENTRY } from '../installation/contract/wire/layout.js';
import type { AdapterEntry } from '@runlith/tagma/adapter/loader';
import type { AdapterPlaces, AdapterSource } from '../providers/contract/service/registry.js';
import { BINDINGS } from '@tagma/server/composition/bindings';

export const adapterPlaces = (home: string | null, entry: string | undefined): AdapterPlaces['Service'] => ({
  machine: home === null ? null : join(home, ADAPTERS),
  release: entry?.endsWith(`/${CLI_ENTRY}`) ? join(entry.slice(0, -CLI_ENTRY.length), ADAPTERS) : null,
  host: BINDINGS.hostModules,
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
