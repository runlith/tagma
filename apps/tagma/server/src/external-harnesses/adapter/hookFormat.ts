import type { HookFormat, HookSurface } from '../contract/service/adapter.js';
import type { HarnessAnswer } from '../contract/wire/call.js';

export const hookFileKeys = (format: HookFormat): Record<string, unknown> => (format === 'cursor' ? { version: 1 } : {});

export const hookEventsAt = (format: HookFormat): 'hooks' | 'root' => (format === 'devin' ? 'root' : 'hooks');

export const hookHole = (format: HookFormat): boolean => format === 'codex';

export type HookTrust = {
  readonly home: string;
  readonly folder: string;
  readonly file: string;
  readonly table: string;
  readonly key: (filePath: string, event: string, group: number, handler: number) => string;
};

const codexTrust: HookTrust = {
  home: 'CODEX_HOME',
  folder: '.codex',
  file: 'config.toml',
  table: 'hooks.state',
  key: (filePath, event, group, handler) => `${filePath}:${event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}:${group}:${handler}`,
};

export const hookTrust = (format: HookFormat): HookTrust | null => (format === 'codex' ? codexTrust : null);

export const hookEntry = (format: HookFormat, command: string, timeout?: number): Record<string, unknown> => {
  const declared = timeout === undefined ? {} : { timeout };
  return format === 'cursor' ? { command, ...declared } : { hooks: [{ type: 'command', command, ...declared }] };
};

export function permissionAnswer(format: HookFormat, answer: HarnessAnswer): string | null {
  if (answer._tag !== 'Allowed' && answer._tag !== 'Denied') return null;
  const allowed = answer._tag === 'Allowed';
  const words = `${answer.reason ?? 'A rule of this project allows it.'} (tagma rule ${answer.ruleId})`;
  if (format === 'cursor') return JSON.stringify({ permission: allowed ? 'allow' : 'deny', user_message: words });
  if (format === 'codex') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: allowed ? 'allow' : 'deny', message: words },
      },
    });
  }
  return JSON.stringify({ decision: allowed ? 'approve' : 'deny', reason: words });
}

export const contextAnswer = (format: HookFormat, text: string): string => {
  if (format === 'cursor') return JSON.stringify({ additional_context: text });
  return format === 'codex' || format === 'gemini' || format === 'devin'
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
    : text;
};

export const toolAnswer = (format: HookFormat, text: string, event: 'PreToolUse' | 'PostToolUse' = 'PostToolUse'): string => {
  if (format === 'cursor') return JSON.stringify({ additional_context: text });
  const hookEventName = format === 'gemini' ? (event === 'PreToolUse' ? 'BeforeTool' : 'AfterTool') : event;
  return JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } });
};

export const promptSupported = (hooks: HookSurface | null): boolean => hooks !== null && hooks.promptContext === true;

export const promptAnswer = (format: HookFormat, text: string): string | null => {
  if (format === 'cursor') return JSON.stringify({ additional_context: text });
  return format === 'codex' || format === 'claude-code'
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })
    : null;
};
