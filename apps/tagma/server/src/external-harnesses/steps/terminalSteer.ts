import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

const STEERING: ReadonlySet<unknown> = new Set(['claude-code', 'codex']);

export const terminalSteerForm: ThreadFormStep = {
  name: '20261021180000_terminal_steer',
  samples: {
    meta: {
      native: { transport: { adapter: 'terminal', profile: 'claude-code', agent: null }, capabilities: { steer: 'none', screen: true } },
    },
  },
  meta: (meta) => {
    const native = meta.native;
    if (!isRecord(native) || !isRecord(native.transport) || !isRecord(native.capabilities)) return null;
    if (native.transport.adapter !== 'terminal' || !STEERING.has(native.transport.profile) || native.capabilities.steer !== 'none')
      return null;
    return { ...meta, native: { ...native, capabilities: { ...native.capabilities, steer: 'step' } } };
  },
};
