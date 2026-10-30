import { makeThreadEntryReader, type ThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { journalSteps } from '../../../threads/journal/formSteps.js';

export const dated: ThreadFormStep = {
  name: '20261010170000_message_when',
  samples: { entry: { type: 'message', when: 'then' } },
  entry: (entry) => {
    if (entry.type !== 'message' || entry.when === undefined) return null;
    const { when, ...rest } = entry;
    return { ...rest, occurredAt: when };
  },
};

const datedWorker = (): Worker => new Worker(new URL('./formSteps.worker.ts', import.meta.url), { type: 'module' });

export const datedKinds = (): ThreadEntryReader =>
  makeThreadEntryReader({ products: [], steps: journalSteps([[dated]]), worker: datedWorker });
