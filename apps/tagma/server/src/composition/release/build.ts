import type { Build } from '../build.js';
import { CORE_VERB_MODULES } from '../cli/core.js';
import { releaseVerbs } from '../../release-channel/verbs.js';
import { applications } from '../../mac-applications/placement.js';
import { CHANNEL } from './channel.js';

export const RELEASE: Build = {
  channel: CHANNEL,
  verbs: [...CORE_VERB_MODULES, { id: 'release-channel', verbs: releaseVerbs }],
  verbBindings: (core) => ({
    'release-channel': [core.installation, async () => (await import('../../mac-applications/placement.js')).applications],
  }),
  parts: async () => (await import('./parts.js')).PARTS,
  cut: {
    conditions: ['release'],
    channel: CHANNEL,
    applications,
    entries: { cli: 'composition/release/cli.ts', server: 'composition/release/server.ts' },
  },
};
