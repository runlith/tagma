import type { HarnessModelReport } from '../../threads/contract/wire/harness/observation.js';
import type { FileEffect } from '../contract/service/adapter.js';
import type { HarnessCall } from '../contract/wire/call.js';

export const tail = (prompt: string | undefined): string[] => (prompt === undefined ? [] : [prompt]);

export function field(event: Record<string, unknown>, name: string): string | null {
  const value = event[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function nested(event: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = event[name];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const sessionIdOf = (event: Record<string, unknown>): string | null => field(event, 'session_id') ?? field(event, 'sessionId');

export const unasked = (): null => null;

export const unturned = (): null => null;

export const unreported = (): null => null;

export const answerField = (said: Record<string, unknown>, key: string | null): string | null => (key === null ? null : field(said, key));

export const unfiled = (): readonly FileEffect[] => [];

export const unprinted = (): null => null;

const PATCH_HEADERS = [
  { mark: '*** Add File:', effect: 'write' },
  { mark: '*** Update File:', effect: 'write' },
  { mark: '*** Delete File:', effect: 'delete' },
] as const;
const MOVE_HEADER = '*** Move to:';

export function patchFiles(patch: string): readonly FileEffect[] {
  const effects: FileEffect[] = [];
  for (const line of patch.split('\n')) {
    const header = PATCH_HEADERS.find((known) => line.startsWith(known.mark));
    if (header !== undefined) {
      const path = line.slice(header.mark.length).trim();
      if (path.length > 0) effects.push({ effect: header.effect, path });
      continue;
    }
    if (!line.startsWith(MOVE_HEADER)) continue;
    const path = line.slice(MOVE_HEADER.length).trim();
    const renamed = effects[effects.length - 1];
    if (path.length === 0) continue;
    if (renamed?.effect === 'write') effects[effects.length - 1] = { effect: 'move', path, from: renamed.path };
    else effects.push({ effect: 'write', path });
  }
  return effects;
}

export const questionTool = (tool?: string): boolean =>
  ['askuserquestion', 'ask_user_question', 'request_user_input'].includes(tool?.toLowerCase() ?? '');

export const rootOfArgv =
  (resumeWord: string, assigns = false) =>
  (argv: readonly string[]): string | null => {
    const words = assigns ? [resumeWord, '--session-id'] : [resumeWord];
    for (let at = 1; at < argv.length; at += 1) {
      const word = argv[at];
      if (word !== undefined && words.includes(word)) return argv[at + 1] ?? null;
    }
    return null;
  };

export const modelField = (event: Record<string, unknown>, defaults: readonly string[] = []): HarnessModelReport | null => {
  if (!('model' in event)) return null;
  const named = field(event, 'model');
  if (named === null) return { read: 'absent' };
  return { read: 'value', value: named, claim: defaults.includes(named) ? 'configured' : 'serving' };
};

export const namedCall = (event: Record<string, unknown>): HarnessCall | null => {
  const tool = field(event, 'tool_name') ?? field(event, 'toolName');
  if (tool === null) return null;
  const input = nested(event, 'tool_input');
  const subject =
    field(input, 'command') ??
    field(input, 'cmd') ??
    field(input, 'file_path') ??
    field(input, 'notebook_path') ??
    field(input, 'path') ??
    field(input, 'url') ??
    field(input, 'query') ??
    field(input, 'pattern') ??
    field(event, 'tool_input') ??
    JSON.stringify(event.tool_input ?? {});
  return { id: field(event, 'tool_use_id') ?? field(event, 'toolUseId'), tool, subject };
};

export const toolCall = (event: Record<string, unknown>, tools: Record<string, string>): HarnessCall | null => {
  const tool = tools[(field(event, 'tool_name') ?? field(event, 'toolName') ?? '').toLowerCase()];
  if (tool === undefined) return null;
  const input = nested(event, 'tool_input');
  const subject = tool === 'bash' ? field(input, 'command') : field(input, 'file_path');
  return subject === null ? null : { id: field(event, 'tool_use_id') ?? field(event, 'toolUseId'), tool, subject };
};
