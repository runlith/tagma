import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';

type Held = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Held => typeof value === 'object' && value !== null && !Array.isArray(value);

const HOSTED_PROVIDER = 'claude-code';
const FIRST_MODEL = 'claude-opus-5-5';
const RUNGS: Readonly<Record<string, string | null>> = {
  'claude-opus-5-5': 'medium',
  'claude-haiku-5-5': 'medium',
  'claude-fable-5-1': 'xhigh',
  'claude-haiku-4-5': null,
};

export const hostedSelectionForm: ThreadFormStep = {
  name: '20261018170000_hosted_selection',
  samples: {
    meta: {
      record: { agentId: 'harness' },
      native: { provider: HOSTED_PROVIDER, model: null, reasoning: null, transport: { adapter: 'acp', profile: 'claude', agent: 'tagma' } },
    },
  },
  meta: (meta) => {
    const native = meta.native;
    if (!isObject(native) || native.provider !== HOSTED_PROVIDER || native.reasoning != null) return null;
    if (!isObject(native.transport) || native.transport.agent == null) return null;
    const model = typeof native.model === 'string' ? native.model : FIRST_MODEL;
    return { ...meta, native: { ...native, model, reasoning: model in RUNGS ? RUNGS[model] : 'high' } };
  },
};
