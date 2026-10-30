import type { FileEffect, HarnessPrinted, HookEvents } from '@runlith/tagma/adapter/harness';
import { field, nested, patchFiles } from '@runlith/tagma/adapter/payload';

export const events: HookEvents = {
  sessionStart: 'SessionStart',
  preWrite: 'PreToolUse',
  postWrite: 'PostToolUse',
  postRead: 'PostToolUse',
  stop: 'Stop',
  permission: 'PermissionRequest',
  prompt: 'UserPromptSubmit',
  toolFailure: 'PostToolUseFailure',
};

export const filesOf = (event: Record<string, unknown>): readonly FileEffect[] => {
  const tool = field(event, 'tool_name');
  const input = nested(event, 'tool_input');
  if (tool === 'patch') return patchFiles(field(input, 'patchText') ?? '');
  if (tool !== 'read' && tool !== 'edit' && tool !== 'write') return [];
  const path = field(input, 'path');
  return path === null ? [] : [{ effect: tool === 'read' ? 'read' : 'write', path }];
};

export const printedOf = (event: Record<string, unknown>): HarnessPrinted | null => {
  const tool = field(event, 'tool_name');
  const input = nested(event, 'tool_input');
  const output = field(event, 'tool_response') ?? '';
  if (tool === 'shell') {
    const command = field(input, 'command');
    return command === null ? null : { _tag: 'Shell', command, output };
  }
  if (tool !== 'grep' && tool !== 'glob') return null;
  const path = field(input, 'path');
  return { _tag: 'Search', found: path === null ? [] : [path], output };
};
