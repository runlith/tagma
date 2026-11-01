import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Schema } from 'effect';

const hosted = Schema.is(
  Schema.Struct({
    transport: Schema.Struct({ adapter: Schema.Literal('acp'), profile: Schema.Literals(['cursor', 'opencode']) }),
    capabilities: Schema.Struct({ compaction: Schema.Literal('foreign') }),
  }),
);

export const hostedCompactionForm: ThreadFormStep = {
  name: '20261101040000_hosted_compaction',
  samples: {
    meta: {
      native: { transport: { adapter: 'acp', profile: 'cursor', agent: 'tagma' }, capabilities: { compaction: 'foreign' } },
    },
  },
  meta: (meta) => {
    const native = meta.native;
    if (!hosted(native)) return null;
    return {
      ...meta,
      native: {
        ...native,
        capabilities:
          native.transport.profile === 'cursor'
            ? { ...native.capabilities, compaction: 'vendor', usage: 'partial' }
            : { ...native.capabilities, compaction: 'session' },
      },
    };
  },
};
