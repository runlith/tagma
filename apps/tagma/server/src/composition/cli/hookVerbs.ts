import type { VerbSources } from '../../cli/verbs.js';
import { externalHarnessVerbs } from '../../external-harnesses/cli.js';
import type { Channel } from '../../installation/contract/wire/channel.js';
import { externalHarnessBindings } from './doorBinding.js';

export const hookVerbs = (channel: Channel): VerbSources => ({
  hook: externalHarnessVerbs(...(externalHarnessBindings(channel) as Parameters<typeof externalHarnessVerbs>)).hook,
});
