import type { HookCodec } from '@runlith/tagma/adapter/hook';

const context = (text: string): string => JSON.stringify({ additional_context: text });

export const cursorCodec: HookCodec = {
  file: {
    keys: { version: 1 },
    events: ['hooks'],
    holes: false,
    trust: null,
    entry: (command, timeout) => ({ command, ...(timeout === undefined ? {} : { timeout }) }),
  },
  permission: ({ allowed, words }) => JSON.stringify({ permission: allowed ? 'allow' : 'deny', user_message: words }),
  context,
  tool: context,
  prompt: context,
};
