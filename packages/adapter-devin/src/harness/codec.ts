import { commandGroup, specificOutput, type HookCodec } from '@runlith/tagma/adapter/hook';

export const devinCodec: HookCodec = {
  file: { keys: {}, events: [], holes: false, trust: null, entry: commandGroup },
  permission: ({ allowed, words }) => JSON.stringify({ decision: allowed ? 'approve' : 'deny', reason: words }),
  context: (text) => specificOutput('SessionStart', text),
  tool: (text, moment) => specificOutput(moment === 'before' ? 'PreToolUse' : 'PostToolUse', text),
  prompt: null,
};
