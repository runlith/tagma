import { approvePermission, commandGroup, eventOutput, toolOutput, type HookCodec } from '@runlith/tagma/adapter/hook';

export const geminiCodec: HookCodec = {
  file: { keys: {}, events: ['hooks'], holes: false, trust: null, entry: commandGroup },
  permission: approvePermission,
  context: eventOutput('SessionStart'),
  tool: toolOutput('BeforeTool', 'AfterTool'),
  prompt: null,
};
