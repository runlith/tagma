import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import {
  adoptedPermissionArgv,
  chosenModelArgv,
  INTERRUPT_KEY,
  LEGACY_TOOLS,
  UNMEASURED_HOOK_CONTEXT,
  unmeasuredKeys,
  unmeasuredScreen,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type HookOccasion,
  type TerminalSurface,
} from '@runlith/tagma/adapter/harness';
import { CLAUDE_EVENTS, claudeCodec, claudeFiles, claudePrinted, claudeOccasion } from '@runlith/tagma/adapter/claude-hooks';
import { rootOfArgv, sessionIdOf, tail, unasked, unreported, unturned } from '@runlith/tagma/adapter/payload';
import { icon } from '../icon';
import { grokReader } from './metadata';
import { GROK_SESSION } from './session';

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

export const grokTerminal: TerminalSurface = {
  tools: LEGACY_TOOLS,
  prefix: 'gb',
  variable: GROK_SESSION.variable,
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
    codec: claudeCodec,
    events: { ...CLAUDE_EVENTS, permission: null },
    user: { folder: ['.grok'], file: 'hooks/tagma.json', homeEnv: 'GROK_HOME' },
    context: UNMEASURED_HOOK_CONTEXT,
  },
  skill: { user: { folder: ['.grok'], file: 'skills/tagma', homeEnv: 'GROK_HOME' } },
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

export const grok: HarnessProvider = {
  id: GROK_SESSION.harness,
  label: 'Grok Build',
  kind: 'harness',
  auth: 'cli',
  icon,
  environment: () => [],
  models: {},
  defaultTextModel: '',
  cacheLifetime: { promisedSeconds: null, prior: null },
  terminal: grokTerminal,
};
