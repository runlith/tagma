import type { Build } from '../build.js';
import { CORE_VERB_MODULES } from '../cli/core.js';
import { buildVerbs } from '../../checkout-builds/verbs.js';
import { applications } from '../../mac-applications/placement.js';
import { CHANNEL } from './channel.js';

export const DEVELOPER: Build = {
  channel: CHANNEL,
  verbs: [...CORE_VERB_MODULES, { id: 'checkout-builds', verbs: buildVerbs }],
  verbBindings: (core) => ({ 'checkout-builds': [core.installation] }),
  parts: async () => (await import('./parts.js')).PARTS,
  cut: {
    conditions: [],
    channel: CHANNEL,
    applications,
    entries: { cli: 'composition/developer/cli.ts', server: 'composition/developer/server.ts' },
  },
};
