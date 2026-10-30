import type { HookCodec } from '@runlith/tagma/adapter/hook';
import { commandGroup, specificOutput } from '../../adapter/hookFormat.js';

export const geminiCodec: HookCodec = {
  file: { keys: {}, events: ['hooks'], holes: false, trust: null, entry: commandGroup },
  permission: ({ allowed, words }) => JSON.stringify({ decision: allowed ? 'approve' : 'deny', reason: words }),
  context: (text) => specificOutput('SessionStart', text),
  tool: (text, moment) => specificOutput(moment === 'before' ? 'BeforeTool' : 'AfterTool', text),
  prompt: null,
};
