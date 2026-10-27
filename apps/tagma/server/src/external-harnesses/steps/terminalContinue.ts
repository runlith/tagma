import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

export const terminalContinueForm: ThreadFormStep = {
  name: '20261027180000_terminal_continue',
  samples: {
    meta: {
      native: { transport: { adapter: 'terminal', profile: 'claude-code', agent: null }, capabilities: { continue: false, screen: true } },
    },
  },
  meta: (meta) => {
    const native = meta.native;
    if (!isRecord(native) || !isRecord(native.transport) || !isRecord(native.capabilities)) return null;
    if (native.transport.adapter !== 'terminal' || native.capabilities.continue !== false) return null;
    return { ...meta, native: { ...native, capabilities: { ...native.capabilities, continue: true } } };
  },
};
