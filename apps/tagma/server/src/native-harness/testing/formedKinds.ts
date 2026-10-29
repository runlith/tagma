import { makeThreadEntryReader, type ThreadFormStep, type ThreadReaderModule } from '@runlith/agent/transcript/kinds';

const textContent: ThreadFormStep = {
  name: '20261010170000_text_content',
  samples: { message: { role: 'user', content: 'before' } },
  message: (message) => (typeof message.content === 'string' ? { ...message, content: [{ type: 'text', text: message.content }] } : null),
};

export const entryKinds: ThreadReaderModule['entryKinds'] = () =>
  makeThreadEntryReader({ products: [], steps: [textContent], source: import.meta.url });
