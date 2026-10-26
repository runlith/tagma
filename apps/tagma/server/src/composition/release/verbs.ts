import type { VerbBindings, VerbModule } from '../cli/binding.js';
import { CORE_VERB_MODULES } from '../cli/core.js';
import { releaseVerbs } from '../../release-channel/verbs.js';

export const COMPOSED_VERB_BINDINGS: VerbBindings = {
  'release-channel': [
    async () => (await import('../cli/installation.js')).installationCli,
    async () => (await import('../../mac-applications/placement.js')).applications,
  ],
};

export const VERB_MODULES: readonly VerbModule[] = [...CORE_VERB_MODULES, { id: 'release-channel', verbs: releaseVerbs }];
