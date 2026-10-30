import { HARNESS_LABELS } from '../../../threads/contract/wire/harness/names.js';
import { LEGACY_TOOLS } from '../tools.js';
import type { TerminalHarnessAdapter } from '../../contract/service/adapter.js';
import { grokReader } from './reader.js';

import {
  adoptedPermissionArgv,
  chosenModelArgv,
  INTERRUPT_KEY,
  UNMEASURED_HOOK_CONTEXT,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type HookOccasion,
} from '@runlith/tagma/adapter/harness';
import { CLAUDE_EVENTS, claudeFiles, claudePrinted, claudeOccasion } from '../../adapter/claudeFormat.js';
import { rootOfArgv, sessionIdOf, tail, unasked, unreported, unturned } from '../../adapter/payload.js';
import { unmeasuredKeys, unmeasuredScreen } from '../../adapter/screenAsk.js';
import { SESSION_VARIABLES } from '../../contract/wire/sessionVariables.js';

const permission = { tagma: ['--always-approve'] } as const satisfies HarnessPermissionArgv;

const model: HarnessModelArgv = null;

const GROK_EVENTS: Record<string, string> = {
  session_start: 'SessionStart',
  user_prompt_submit: 'UserPromptSubmit',
  pre_tool_use: 'PreToolUse',
  post_tool_use: 'PostToolUse',
  post_tool_use_failure: 'PostToolUseFailure',
  stop: 'Stop',
  stop_failure: 'StopFailure',
  session_end: 'SessionEnd',
  notification: 'Notification',
};

const grokOccasion: HookOccasion = (event) => {
  const name = GROK_EVENTS[event.name] ?? event.name;
  return name === 'Notification' ? 'self-description' : claudeOccasion({ ...event, name });
};

const GROK_COMPOSER = /^│ ❯(?: (.*?))?\s*│$/;
const GROK_CONTINUED = /^│ (.*?)\s*│$/;
const GROK_BOTTOM = /^╰─/;

const grokComposer = (lines: readonly string[]): string | null => {
  const at = lines.findLastIndex((line) => GROK_COMPOSER.test(line.trim()));
  if (at < 0) return null;
  const drawn = [GROK_COMPOSER.exec(lines[at]!.trim())![1] ?? ''];
  for (const line of lines.slice(at + 1)) {
    if (GROK_BOTTOM.test(line.trim())) break;
    const continued = GROK_CONTINUED.exec(line.trim());
    if (continued === null) return null;
    drawn.push(continued[1]!.trim());
  }
  const text = drawn.join('\n').trim();
  return text === '' ? null : text;
};

export const grok: TerminalHarnessAdapter = {
  harness: 'grok',
  tools: LEGACY_TOOLS,
  label: HARNESS_LABELS.grok,
  iconProvider: 'xai',
  prefix: 'gb',
  variable: SESSION_VARIABLES.grok,
  binary: 'grok',
  metadata: grokReader,
  launch: {
    permission,
    model,
    interactive: (prompt, choice) => ['grok', ...adoptedPermissionArgv(permission), ...chosenModelArgv(model, choice), ...tail(prompt)],
    assign: (key, prompt, choice) => [
      'grok',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '--session-id',
      key,
      ...tail(prompt),
    ],
    resume: (key, prompt, choice) => [
      'grok',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '--resume',
      key,
      ...tail(prompt),
    ],
    root: rootOfArgv('--resume', true),
    cut: {
      whole: {
        _tag: 'Launch',
        argv: (ask, into, prompt, choice, permissions) => [
          'grok',
          ...(permissions ?? adoptedPermissionArgv(permission)),
          ...chosenModelArgv(model, choice),
          '--resume',
          ask.root,
          '--fork-session',
          '--session-id',
          into,
          ...tail(prompt),
        ],
        rows: 'copied',
      },
      point: null,
    },
  },
  hooks: {
    file: '.grok/hooks/tagma.json',
    format: 'claude-code',
    events: { ...CLAUDE_EVENTS, permission: null },
    user: { folder: ['.grok'], file: 'hooks/tagma.json', homeEnv: 'GROK_HOME' },
    context: UNMEASURED_HOOK_CONTEXT,
  },
  mcpTools: 'catalog',
  mcp: {
    file: { _tag: 'Project', path: '.grok/config.toml' },
    format: 'toml',
    servers: 'mcp_servers',
    fields: { enabled: true },
  },
  occasionOf: grokOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: unreported,
  reportsModel: false,
  turnOf: unturned,
  answerKey: 'lastAssistantMessage',
  subjectOf: unasked,
  filesOf: claudeFiles,
  printedOf: claudePrinted,
  eventKeys: [
    'hook_event_name',
    'hookEventName',
    'session_id',
    'sessionId',
    'tool_name',
    'toolName',
    'notification_type',
    'notificationType',
  ],
  screenAskOf: unmeasuredScreen,
  composer: { of: grokComposer, drafted: [INTERRUPT_KEY, INTERRUPT_KEY, { _tag: 'char', char: '\u001a' }] },
  keysOf: unmeasuredKeys,
  cancelKeysOf: unmeasuredKeys,
  interrupt: [INTERRUPT_KEY],
  steer: 'none',
  quit: null,
  callEnvelopeMs: null,
  ends: { interrupt: 'screen', idle: 'notification', tail: 'prompt' },
};
