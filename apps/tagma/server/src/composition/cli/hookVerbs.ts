import type { VerbSources } from '../../cli/verbs.js';
import { externalHarnessVerbs } from '../../external-harnesses/cli.js';
import { EXTERNAL_HARNESS_BINDINGS } from './doorBinding.js';

export const HOOK_VERBS: VerbSources = {
  hook: externalHarnessVerbs(...(EXTERNAL_HARNESS_BINDINGS as Parameters<typeof externalHarnessVerbs>)).hook,
};
