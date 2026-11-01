import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Build } from '../build.js';
import { CORE_VERB_MODULES } from '../cli/core.js';
import { sourceDistribution } from '../sources.js';
import { releaseVerbs } from '../../release-channel/verbs.js';
import { CHANNEL } from './channel.js';

const here = fileURLToPath(new URL('./', import.meta.url));

export const RELEASE: Build = {
  channel: CHANNEL,
  verbs: [...CORE_VERB_MODULES, { id: 'release-channel', verbs: releaseVerbs }],
  verbBindings: (core) => ({
    'release-channel': [core.installation, async () => (await import('../../mac-applications/placement.js')).applications],
  }),
  parts: async () => (await import('./parts.js')).PARTS,
  cut: sourceDistribution({ cli: join(here, 'cli.ts'), server: join(here, 'server.ts') }, ['release']),
};
