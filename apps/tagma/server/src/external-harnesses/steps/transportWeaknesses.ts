import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';

type Held = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Held => typeof value === 'object' && value !== null && !Array.isArray(value);

const weaknesses = (transport: Held): Held => {
  const { adapter, profile } = transport;
  const claude = profile === 'claude';
  return {
    feed: adapter === 'terminal' ? 'turns' : 'full',
    usage: adapter === 'native' || (adapter === 'acp' && claude) ? 'measured' : adapter === 'terminal' && claude ? 'partial' : 'none',
    aside: adapter === 'native' ? 'request' : adapter === 'acp' && claude ? 'session' : 'none',
  };
};

export const weaknessesForm: ThreadFormStep = {
  name: '20261018075806_transport_weaknesses',
  samples: {
    meta: {
      record: { agentId: 'harness' },
      native: { transport: { adapter: 'terminal', profile: 'claude', agent: null }, capabilities: { screen: true, continue: false } },
    },
  },
  meta: (meta) => {
    const native = meta.native;
    if (!isObject(native) || !isObject(native.capabilities) || native.capabilities.feed !== undefined) return null;
    const transport = isObject(native.transport) ? native.transport : { adapter: 'native' };
    return { ...meta, native: { ...native, capabilities: { ...native.capabilities, ...weaknesses(transport) } } };
  },
};
