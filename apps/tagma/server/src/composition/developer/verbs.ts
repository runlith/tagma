import type { VerbBindings, VerbModule } from '../cli/binding.js';
import { CORE_VERB_MODULES } from '../cli/core.js';
import { buildVerbs } from '../../checkout-builds/verbs.js';

export const COMPOSED_VERB_BINDINGS: VerbBindings = {
  'checkout-builds': [async () => (await import('../cli/installation.js')).installationCli],
};

export const VERB_MODULES: readonly VerbModule[] = [...CORE_VERB_MODULES, { id: 'checkout-builds', verbs: buildVerbs }];
