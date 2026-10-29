import { MODULES } from '@tagma/server/composition/modules';
import { makeThreadEntryReader, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { JOURNAL_BASE, journalSteps } from '../threads/journal/formSteps.js';

const modules: readonly Manifest[] = MODULES;

const worker = (): Worker => new Worker(new URL('./rested.worker.ts', import.meta.url), { type: 'module' });

export const entryKinds = (): ThreadEntryReader =>
  makeThreadEntryReader({
    products: modules.flatMap((module) => module.entryKinds ?? []),
    steps: journalSteps(modules.map((module) => module.formSteps ?? [])),
    base: JOURNAL_BASE,
    worker,
  });
