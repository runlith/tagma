import { join } from 'node:path';
import { ADAPTERS } from '../installation/contract/wire/layout.js';
import type { Adapter, HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { HostedRunner } from '@runlith/hosted-runner/run';
import type { Signer } from '../cli/contract/service/server.js';
import type { AdapterPlaces, AdapterSource } from '../providers/contract/service/registry.js';
import { HOST_MODULES } from './hostModules.generated.js';

export const adapterPlaces = (home: string | null): AdapterPlaces['Service'] => ({
  machine: home === null ? null : join(home, ADAPTERS),
  host: HOST_MODULES,
});

type BuiltinHarness = {
  readonly id: string;
  readonly load: () => Promise<HarnessProvider>;
  readonly signer?: () => Promise<Signer>;
  readonly runner?: () => Promise<HostedRunner>;
};

type Builtin = AdapterSource & { readonly harness?: BuiltinHarness };

const builtin = (id: string, load: () => Promise<{ readonly adapter: Adapter }>, harness?: BuiltinHarness): Builtin => ({
  id,
  origin: 'builtin',
  version: null,
  load: async () => (await load()).adapter,
  harness,
});

export const BUILTIN_ADAPTERS: readonly Builtin[] = [
  builtin('anthropic', () => import('@runlith/adapter-anthropic/adapter'), {
    id: 'claude-code',
    load: async () => (await import('@runlith/adapter-anthropic/harness')).claudeCode,
    signer: async () => (await import('@runlith/adapter-anthropic/harness/session')).CLAUDE_SESSION,
    runner: async () => (await import('@runlith/adapter-anthropic/runner')).claudeRunner,
  }),
  builtin('openai', () => import('@runlith/adapter-openai/adapter'), {
    id: 'codex',
    load: async () => (await import('@runlith/adapter-openai/harness')).codex,
    signer: async () => (await import('@runlith/adapter-openai/harness/session')).CODEX_SESSION,
  }),
  builtin('cursor', () => import('@runlith/adapter-cursor/adapter'), {
    id: 'cursor',
    load: async () => (await import('@runlith/adapter-cursor/adapter')).cursor,
    runner: async () => (await import('@runlith/adapter-cursor/runner')).cursorRunner,
  }),
  builtin('xai', () => import('@runlith/adapter-xai/adapter'), {
    id: 'grok',
    load: async () => (await import('@runlith/adapter-xai/harness')).grok,
    signer: async () => (await import('@runlith/adapter-xai/harness/session')).GROK_SESSION,
  }),
  builtin('google', () => import('@runlith/adapter-google/adapter'), {
    id: 'gemini',
    load: async () => (await import('@runlith/adapter-google/harness')).gemini,
  }),
  builtin('muse', () => import('@runlith/adapter-muse/adapter'), {
    id: 'muse-code',
    load: async () => (await import('@runlith/adapter-muse/harness')).museCode,
    runner: async () => (await import('@runlith/adapter-muse/runner')).museCodeRunner,
  }),
  builtin('devin', () => import('@runlith/adapter-devin/adapter'), {
    id: 'devin',
    load: async () => (await import('@runlith/adapter-devin/harness')).devin,
  }),
  builtin('opencode-go', () => import('@runlith/adapter-opencode-go/adapter')),
  builtin('opencode', () => import('@runlith/adapter-opencode/adapter'), {
    id: 'opencode',
    load: async () => (await import('@runlith/adapter-opencode/harness')).opencode,
    signer: async () => (await import('@runlith/adapter-opencode/harness/session')).OPENCODE_SESSION,
    runner: async () => (await import('@runlith/adapter-opencode/runner')).opencodeRunner,
  }),
  builtin('stepfun', () => import('@runlith/adapter-stepfun/adapter')),
  builtin('deepseek', () => import('@runlith/adapter-deepseek/adapter')),
  builtin('openrouter', () => import('@runlith/adapter-openrouter/adapter')),
  builtin('openai-compatible', () => import('@runlith/adapter-openai-compatible/adapter')),
];

export const BUILTIN_HARNESS_PROVIDERS: ReadonlyMap<string, BuiltinHarness> = new Map(
  BUILTIN_ADAPTERS.flatMap(({ harness }) => (harness === undefined ? [] : [[harness.id, harness] as const])),
);

export const BUILTIN_HOSTED_RUNNERS: ReadonlyMap<string, () => Promise<HostedRunner>> = new Map(
  [...BUILTIN_HARNESS_PROVIDERS].flatMap(([id, { runner }]) => (runner === undefined ? [] : [[id, runner] as const])),
);
