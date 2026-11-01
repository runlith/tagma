import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Build } from '../build.js';
import { CORE_VERB_MODULES } from '../cli/core.js';
import { sourceDistribution } from '../sources.js';
import { buildVerbs } from '../../checkout-builds/verbs.js';
import { CHANNEL } from './channel.js';

const here = fileURLToPath(new URL('./', import.meta.url));

export const DEVELOPER: Build = {
  channel: CHANNEL,
  verbs: [...CORE_VERB_MODULES, { id: 'checkout-builds', verbs: buildVerbs }],
  verbBindings: (core) => ({ 'checkout-builds': [core.installation] }),
  parts: async () => (await import('./parts.js')).PARTS,
  cut: sourceDistribution({ cli: join(here, 'cli.ts'), server: join(here, 'server.ts') }, []),
};
