import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

export const terminalHistoryForm: ThreadFormStep = {
  name: '20261025160000_terminal_history',
  samples: {
    meta: {
      native: {
        transport: { adapter: 'terminal', profile: 'claude-code', agent: null },
        capabilities: { messaging: true, history: 'none', screen: true },
      },
    },
  },
  meta: (meta) => {
    const native = meta.native;
    if (!isRecord(native) || !isRecord(native.transport) || !isRecord(native.capabilities)) return null;
    const { capabilities } = native;
    if (native.transport.adapter !== 'terminal' || capabilities.messaging !== true || capabilities.history !== 'none') return null;
    return {
      ...meta,
      native: { ...native, capabilities: { ...capabilities, history: 'session', copies: { whole: 'record', point: 'record' } } },
    };
  },
};
