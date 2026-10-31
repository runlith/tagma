import { makeThreadEntryReader, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { JOURNAL_BASE, journalSteps } from '../threads/journal/formSteps.js';

export const entryKinds = (modules: readonly Manifest[], worker: () => Worker): ThreadEntryReader =>
  makeThreadEntryReader({
    products: modules.flatMap((module) => module.entryKinds ?? []),
    steps: journalSteps(modules.map((module) => module.formSteps ?? [])),
    base: JOURNAL_BASE,
    worker,
  });
