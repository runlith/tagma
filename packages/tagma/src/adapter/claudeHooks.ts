import type { FileEffect, HarnessCall, HarnessPrinted, HookEvents, HookOccasion } from './harness';
import { approvePermission, commandGroup, eventOutput, toolOutput, type HookCodec } from './hook';
import { field, nested, questionTool, toolCall } from './payload';

export const claudeCodec: HookCodec = {
  file: { keys: {}, events: ['hooks'], holes: false, trust: null, entry: commandGroup },
  permission: approvePermission,
  context: (text) => text,
  tool: toolOutput('PreToolUse', 'PostToolUse'),
  prompt: eventOutput('UserPromptSubmit'),
};

export const CLAUDE_EVENTS: HookEvents = {
  sessionStart: 'SessionStart',
  preWrite: 'PreToolUse',
  postWrite: 'PostToolUse',
  postRead: 'PostToolUse',
  stop: 'Stop',
  permission: 'PermissionRequest',
  prompt: 'UserPromptSubmit',
  sessionEnd: 'SessionEnd',
  toolFailure: 'PostToolUseFailure',
  stopFailure: 'StopFailure',
  notification: 'Notification',
};

const CLAUDE_TOOLS: Record<string, string> = {
  bash: 'bash',
  exec: 'bash',
  edit: 'edit',
  multiedit: 'edit',
  write: 'write',
  read: 'read',
};

export const claudeSubject = (event: Record<string, unknown>): HarnessCall | null => toolCall(event, CLAUDE_TOOLS);

export const claudeFiles = (event: Record<string, unknown>): readonly FileEffect[] => {
  const path = field(nested(event, 'tool_input'), 'file_path');
  if (path === null) return [];
  const tool = field(event, 'tool_name') ?? field(event, 'toolName');
  return [{ effect: tool !== null && tool.toLowerCase() !== 'read' ? 'write' : 'read', path }];
};

const responseText = (event: Record<string, unknown>, keys: readonly string[]): string => {
  const response = event.tool_response;
  if (typeof response === 'string') return response;
  const fields = nested(event, 'tool_response');
  return keys.flatMap((key) => (typeof fields[key] === 'string' ? [fields[key]] : [])).join('\n');
};

export const claudePrinted = (event: Record<string, unknown>): HarnessPrinted | null => {
  const tool = (field(event, 'tool_name') ?? field(event, 'toolName'))?.toLowerCase();
  const input = nested(event, 'tool_input');
  if (tool === 'bash') {
    const command = field(input, 'command');
    return command === null ? null : { _tag: 'Shell', command, output: responseText(event, ['stdout', 'stderr']) };
  }
  if (tool !== 'grep') return null;
  const listed = nested(event, 'tool_response').filenames;
  const searched = field(input, 'path');
  const found = [
    ...(Array.isArray(listed) ? listed.filter((path): path is string => typeof path === 'string') : []),
    ...(searched === null ? [] : [searched]),
  ];
  return { _tag: 'Search', found, output: responseText(event, ['content']) };
};

export const claudeOccasion: HookOccasion = (event) => {
  switch (event.name) {
    case 'SessionStart':
      return 'session-start';
    case 'UserPromptSubmit':
      return 'turn-start';
    case 'Stop':
    case 'StopFailure':
    case 'SessionEnd':
      return 'turn-end';
    case 'PermissionRequest':
      return 'self-description';
    case 'PreToolUse':
      return questionTool(event.tool) ? 'wait' : 'activity';
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return 'activity';
    default:
      return 'self-description';
  }
};
