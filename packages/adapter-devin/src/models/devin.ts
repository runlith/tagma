import {
  type ModelSelection,
  type ModelSpec,
  type ModelSpecs,
  type ModelSwitch,
  type ModelVendor,
  type ProviderDescription,
  SPEED_SWITCH_ICON,
} from '@runlith/llm/models/description';

export const DEVIN_PROVIDER = 'devin';

export const DEFAULT_DEVIN_MODEL = 'claude-opus-5';

type DevinRow = {
  readonly label: string;
  readonly short?: string;
  readonly servedAs: string;
  readonly context: number;
  readonly output: number;
  readonly rungs: readonly string[];
  readonly speed?: 'fast' | 'priority';
  readonly operatorOnly?: true;
  readonly vision?: true;
};

const DEVIN_SPEED_SWITCH = 'speed';
const speedSwitch = (suffix: 'fast' | 'priority'): readonly ModelSwitch[] => [
  {
    id: DEVIN_SPEED_SWITCH,
    label: 'Fast',
    description: 'Priority inference, at a higher cost tier',
    values: [
      { id: 'standard', label: 'Standard' },
      { id: suffix, label: 'Fast' },
    ],
    default: null,
    icon: SPEED_SWITCH_ICON,
  },
];

const DEVIN_ROWS = {
  [DEFAULT_DEVIN_MODEL]: {
    label: 'Opus 5',
    short: 'Opus',
    servedAs: 'claude-opus-5',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
    speed: 'fast',
  },
  'claude-fable-5-1': {
    label: 'Fable 5.1',
    short: 'Fable',
    servedAs: 'claude-fable-5-1',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
    operatorOnly: true,
  },
  'claude-sonnet-5': {
    label: 'Sonnet 5',
    short: 'Sonnet',
    servedAs: 'claude-sonnet-5',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'claude-opus-4-8': {
    label: 'Opus 4.8',
    short: 'Opus',
    servedAs: 'claude-opus-4-8',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
    speed: 'fast',
  },
  'claude-opus-4-7': {
    label: 'Opus 4.7',
    short: 'Opus',
    servedAs: 'claude-opus-4-7',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'claude-fable-5': {
    label: 'Fable 5',
    short: 'Fable',
    servedAs: 'claude-5-fable',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
    operatorOnly: true,
  },
  'gpt-6-astra': {
    label: 'GPT-6 Astra',
    short: 'Astra',
    servedAs: 'gpt-6-astra',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh', 'max'],
    speed: 'priority',
  },
  'gpt-5.6-sol': {
    label: 'GPT-5.6 Sol',
    short: 'Sol 5.6',
    servedAs: 'gpt-5-6-sol',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    speed: 'priority',
  },
  'gpt-5.6-terra': {
    label: 'GPT-5.6 Terra',
    short: 'Terra',
    servedAs: 'gpt-5-6-terra',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    speed: 'priority',
  },
  'gpt-5.6-luna': {
    label: 'GPT-5.6 Luna',
    short: 'Luna 5.6',
    servedAs: 'gpt-5-6-luna',
    vision: true,
    context: 1_000_000,
    output: 128_000,
    rungs: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    speed: 'priority',
  },
  'gpt-5.5': {
    label: 'GPT-5.5',
    short: '5.5',
    servedAs: 'gpt-5-5',
    vision: true,
    context: 272_000,
    output: 128_000,
    rungs: ['none', 'low', 'medium', 'high', 'xhigh'],
    speed: 'priority',
  },
  'gpt-5.3-codex': {
    label: 'GPT-5.3 Codex',
    short: 'Codex',
    servedAs: 'gpt-5-3-codex',
    vision: true,
    context: 400_000,
    output: 128_000,
    rungs: ['low', 'medium', 'high', 'xhigh'],
    speed: 'priority',
  },
  'grok-4.6': {
    label: 'Grok 4.6',
    short: 'Grok',
    servedAs: 'grok-4-6',
    vision: true,
    context: 500_000,
    output: 100_000,
    rungs: ['low', 'medium', 'high', 'xhigh'],
  },
  'grok-4.5': {
    label: 'Grok 4.5',
    short: 'Grok',
    servedAs: 'grok-4-5',
    vision: true,
    context: 500_000,
    output: 100_000,
    rungs: ['low', 'medium', 'high'],
  },
  'kimi-k3': {
    label: 'K3',
    servedAs: 'kimi-k3',
    vision: true,
    context: 1_048_576,
    output: 131_072,
    rungs: ['low', 'high', 'max'],
  },
  'kimi-k2.7': {
    label: 'Kimi K2.7',
    short: 'K2.7',
    servedAs: 'kimi-k2-7',
    vision: true,
    context: 262_144,
    output: 16_000,
    rungs: [],
  },
  'kimi-k2.6': {
    label: 'Kimi K2.6',
    short: 'K2.6',
    servedAs: 'kimi-k2-6',
    vision: true,
    context: 262_144,
    output: 8_192,
    rungs: [],
  },
  'glm-5.3': {
    label: 'GLM-5.3',
    short: 'GLM',
    servedAs: 'glm-5-3',
    context: 1_048_576,
    output: 128_000,
    rungs: ['low', 'high', 'max'],
  },
  'glm-5.3-flash': {
    label: 'GLM-5.3 Flash',
    short: 'GLM Flash',
    servedAs: 'glm-5-3-flash',
    context: 1_000_000,
    output: 128_000,
    rungs: ['low', 'high', 'max'],
  },
  'deepseek-v4.1-flash': {
    label: 'DeepSeek V4.1 Flash',
    short: 'DS Flash',
    servedAs: 'deepseek-v4-1-flash',
    vision: true,
    context: 1_048_576,
    output: 384_000,
    rungs: ['high', 'max'],
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    servedAs: 'deepseek-v4-pro',
    context: 1_048_576,
    output: 384_000,
    rungs: ['high', 'max'],
  },
  'gemini-4-argon': {
    label: 'Gemini 4 Argon',
    short: 'Argon',
    servedAs: 'gemini-4-argon',
    vision: true,
    context: 1_048_576,
    output: 1_000_000,
    rungs: ['low', 'medium', 'high'],
  },
  'gemini-3.8-flash': {
    label: 'Gemini 3.8 Flash',
    short: 'Flash',
    servedAs: 'gemini-3-8-flash',
    vision: true,
    context: 1_048_576,
    output: 65_535,
    rungs: ['low', 'medium', 'high'],
  },
  'gemini-3.1-pro': {
    label: 'Gemini 3.1 Pro',
    short: 'Pro',
    servedAs: 'gemini-3-1-pro',
    vision: true,
    context: 1_048_576,
    output: 65_535,
    rungs: ['low', 'high'],
  },
  'swe-2': {
    label: 'SWE-2',
    short: 'SWE-2',
    servedAs: 'swe-2',
    context: 262_000,
    output: 128_000,
    rungs: ['medium', 'high', 'max'],
  },
  'swe-1.6': {
    label: 'SWE-1.6',
    short: 'SWE',
    servedAs: 'swe-1-6',
    context: 200_000,
    output: 128_000,
    rungs: [],
  },
  inkling: {
    label: 'Inkling',
    short: 'Inkling',
    servedAs: 'inkling',
    context: 1_048_576,
    output: 131_072,
    rungs: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  'nemotron-3-ultra': {
    label: 'Nemotron 3 Ultra',
    short: 'Nemotron',
    servedAs: 'nemotron-3-ultra',
    context: 1_000_000,
    output: 32_768,
    rungs: ['none', 'medium', 'high'],
  },
} satisfies Readonly<Record<string, DevinRow>>;

function devinDefaultRung(rungs: readonly string[]): string | null {
  if (rungs.length === 0) return null;
  return rungs.includes('high') ? 'high' : (rungs.at(-1) ?? null);
}

function devinSpec(row: DevinRow): ModelSpec {
  return {
    label: row.label,
    short: row.short || undefined,
    servedAs: row.servedAs,
    capacity: { context: row.context, output: row.output },
    capabilities: row.vision ? ['text', 'vision'] : ['text'],
    reasoning: row.rungs,
    defaultReasoning: devinDefaultRung(row.rungs),
    switches: row.speed ? speedSwitch(row.speed) : undefined,
    operatorOnly: row.operatorOnly || undefined,
  };
}

export const DEVIN_SPECS: ModelSpecs = Object.fromEntries(Object.entries(DEVIN_ROWS).map(([id, row]) => [id, devinSpec(row)]));

export function spellDevinSelection({ model, rung, switches }: ModelSelection): string {
  const row: DevinRow | undefined = DEVIN_ROWS[model as keyof typeof DEVIN_ROWS];
  if (!row) {
    throw new Error(`"${model}" is not a Devin model — it serves: ${Object.keys(DEVIN_ROWS).join(', ')}.`);
  }
  if (row.rungs.length === 0) {
    if (rung) throw new Error(`Devin's "${model}" takes no reasoning rung, and "${rung}" was named.`);
    return row.servedAs;
  }
  if (!rung) throw new Error(`Devin spells "${model}" with its rung inside the id; name one of: ${row.rungs.join(', ')}.`);
  if (!row.rungs.includes(rung)) {
    throw new Error(`Devin's "${model}" has no "${rung}" rung — it offers: ${row.rungs.join(', ')}.`);
  }
  const speed = row.speed && switches?.[DEVIN_SPEED_SWITCH] === row.speed ? row.speed : undefined;
  return [row.servedAs, rung, speed].filter(Boolean).join('-');
}

export const devinDescription: ProviderDescription = {
  id: DEVIN_PROVIDER,
  label: 'Devin',
  auth: 'cli',
  models: DEVIN_SPECS,
  cacheLifetime: { promisedSeconds: null, prior: null },
  defaultTextModel: DEFAULT_DEVIN_MODEL,
  spawnTextModel: DEFAULT_DEVIN_MODEL,
  spell: spellDevinSelection,
};

export const devinVendor = { providers: [devinDescription] } as const satisfies ModelVendor;
