import { makeThreadEntryReader, type ThreadEntryReader, type ThreadFormStep } from '@runlith/agent/transcript/kinds';

const textContent: ThreadFormStep = {
  name: '20261010170000_text_content',
  samples: { message: { role: 'user', content: 'before' } },
  message: (message) => (typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : null),
};

const formedWorker = (): Worker => new Worker(new URL('./formed.worker.ts', import.meta.url), { type: 'module' });

const coreWorker = (): Worker => new Worker(new URL('./core.worker.ts', import.meta.url), { type: 'module' });

export const formedKinds = (): ThreadEntryReader => makeThreadEntryReader({ products: [], steps: [textContent], worker: formedWorker });

export const coreKinds = (): ThreadEntryReader => makeThreadEntryReader({ products: [], worker: coreWorker });
