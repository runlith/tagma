import { MODULES } from '@tagma/server/composition/modules';
import { makeThreadEntryReader, type ThreadReaderModule } from '@runlith/agent/transcript/kinds';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { JOURNAL_BASE, journalSteps } from '../threads/journal/formSteps.js';

const modules: readonly Manifest[] = MODULES;

export const entryKinds: ThreadReaderModule['entryKinds'] = () =>
  makeThreadEntryReader({
    products: modules.flatMap((module) => module.entryKinds ?? []),
    steps: journalSteps(modules.map((module) => module.formSteps ?? [])),
    base: JOURNAL_BASE,
    source: new URL('./entryKinds.ts', import.meta.url).href,
  });
