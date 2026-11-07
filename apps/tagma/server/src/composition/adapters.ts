import type { Adapter, HarnessProvider } from '@runlith/tagma/adapter/provider';
import type { HostedRunner } from '@runlith/hosted-runner/run';
import type { Signer } from '../cli/contract/service/server.js';
import type { BuiltinPlugin } from '../plugins/contract/service/plugins.js';
import type { AdapterSource } from '../providers/contract/service/registry.js';
import { BUILTIN_SPEECH } from './builtinSpeech.js';

type BuiltinHarness = {
  readonly id: string;
  readonly load: () => Promise<HarnessProvider>;
  readonly signer?: () => Promise<Signer>;
  readonly runner?: () => Promise<HostedRunner>;
};

type Builtin = AdapterSource & { readonly harness?: BuiltinHarness };

type Shipped = Omit<BuiltinPlugin, 'providers'>;

const SHIPPED: readonly Shipped[] = [
  { id: 'anthropic', title: 'Anthropic', description: 'Claude models and the Claude Code agent.' },
  { id: 'openai', title: 'OpenAI', description: 'OpenAI models, the Codex agent, and OpenAI speech recognition and voices.' },
  { id: 'cursor', title: 'Cursor', description: 'The Cursor agent and the models it serves.' },
  { id: 'xai', title: 'xAI', description: 'Grok models and the Grok agent.' },
  { id: 'google', title: 'Google', description: 'The Gemini CLI agent and the models it serves.' },
  { id: 'muse', title: 'Muse', description: 'Muse models and the Muse Code agent.' },
  { id: 'devin', title: 'Devin', description: 'The Devin agent and the models it serves.' },
  { id: 'opencode-go', title: 'OpenCode Go', description: 'The models of an OpenCode Go subscription.' },
  { id: 'opencode', title: 'OpenCode', description: 'The OpenCode agent and the models it serves.' },
  { id: 'stepfun', title: 'StepFun', description: 'StepFun models.' },
  { id: 'deepseek', title: 'DeepSeek', description: 'DeepSeek models.' },
  { id: 'openrouter', title: 'OpenRouter', description: 'The models OpenRouter serves.' },
  { id: 'openai-compatible', title: 'OpenAI-compatible server', description: 'Models of any server that speaks the OpenAI API.' },
  { id: 'soniox', title: 'Soniox', description: 'Soniox speech recognition and voices.' },
  { id: 'whisper', title: 'Whisper', description: 'Speech recognition on this Mac, with no account.' },
];

const builtin = (id: string, load: () => Promise<{ readonly adapter: Adapter }>, harness?: BuiltinHarness): Builtin => ({
  id,
  title: SHIPPED.find((plugin) => plugin.id === id)?.title ?? id,
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

const adapterOf = new Map(BUILTIN_ADAPTERS.map((source) => [source.id, source]));

const speaks = new Set<string>(BUILTIN_SPEECH);

export const BUILTIN_PLUGINS: readonly BuiltinPlugin[] = SHIPPED.map((plugin) => {
  const models = adapterOf.get(plugin.id);
  return {
    ...plugin,
    providers: { models: models !== undefined, harnesses: models?.harness !== undefined, speech: speaks.has(plugin.id) },
  };
});

export const BUILTIN_HARNESS_PROVIDERS: ReadonlyMap<string, BuiltinHarness> = new Map(
  BUILTIN_ADAPTERS.flatMap(({ harness }) => (harness === undefined ? [] : [[harness.id, harness] as const])),
);

export const BUILTIN_HOSTED_RUNNERS: ReadonlyMap<string, () => Promise<HostedRunner>> = new Map(
  [...BUILTIN_HARNESS_PROVIDERS].flatMap(([id, { runner }]) => (runner === undefined ? [] : [[id, runner] as const])),
);
