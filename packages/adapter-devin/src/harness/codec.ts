import { approvePermission, commandGroup, eventOutput, toolOutput, type HookCodec } from '@runlith/tagma/adapter/hook';

export const devinCodec: HookCodec = {
  file: { keys: {}, events: [], holes: false, trust: null, entry: commandGroup },
  permission: approvePermission,
  context: eventOutput('SessionStart'),
  tool: toolOutput('PreToolUse', 'PostToolUse'),
  prompt: null,
};
