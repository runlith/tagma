import type { AccountEnvironment, HarnessProvider } from '@runlith/tagma/adapter/provider';
import {
  adoptedPermissionArgv,
  ASKS_IN_REVIEW,
  ASKS_NEVER,
  chosenModelArgv,
  HOOK_CONTEXT_CHARS,
  INTERRUPT_KEY,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type HarnessPermissionModes,
  type HarnessWidgetKey,
  type TerminalSurface,
} from '@runlith/tagma/adapter/harness';
import { CLAUDE_EVENTS, claudeCodec, claudeFiles, claudePrinted, claudeOccasion } from '@runlith/tagma/adapter/claude-hooks';
import { field, namedCall, rootOfArgv, sessionIdOf, unreported } from '@runlith/tagma/adapter/payload';
import { claudeAccounts } from '../accounts.js';
import { claudeCodeIcon, icon } from '../icon.js';
import { CLAUDE_CODE_PROVIDER, claudeCodeDescription } from '../models/anthropic.js';
import { claudeCodeProgram } from '../program.js';
import { claudeAcp } from './acp.js';
import { claudeCarry } from './carry.js';
import { claudeComposer, claudePromptScreen } from './composer.js';
import { claudeAddress, claudeCut } from './cut.js';
import { stopFailureOf } from './failure.js';
import { claudeReader } from './reader.js';
import { claudeScreenAsk, claudeWidgetKeys } from './screen.js';
import { CLAUDE_SESSION } from './session.js';

const permission = { tagma: ['--dangerously-skip-permissions'] } as const satisfies HarnessPermissionArgv;

const permissionModes: HarnessPermissionModes = {
  values: ['auto', 'acceptEdits', 'bypassPermissions', 'manual', 'dontAsk', 'plan'],
  argv: (mode) => ['--permission-mode', mode],
};

const prompted = (prompt: string | undefined): string[] => (prompt === undefined ? [] : ['--', prompt]);

const model: HarnessModelArgv = {
  provider: CLAUDE_CODE_PROVIDER,
  argv: (choice) => ['--model', choice.model, ...(choice.rung === null ? [] : ['--effort', choice.rung])],
};

export const claudeTerminal: TerminalSurface = {
  tools: {
    names: 'vendor',
    byName: {
      agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      artifact: { kind: 'network', approval: ASKS_IN_REVIEW },
      askuserquestion: { kind: 'execute', approval: ASKS_IN_REVIEW },
      bash: { kind: 'execute', approval: ASKS_IN_REVIEW },
      bashoutput: { kind: 'read', approval: ASKS_NEVER },
      croncreate: { kind: 'write', approval: ASKS_IN_REVIEW },
      crondelete: { kind: 'write', approval: ASKS_IN_REVIEW },
      cronlist: { kind: 'read', approval: ASKS_NEVER },
      edit: { kind: 'write', approval: ASKS_IN_REVIEW },
      endconversation: { kind: 'execute', approval: ASKS_IN_REVIEW },
      enterplanmode: { kind: 'execute', approval: ASKS_IN_REVIEW },
      enterworktree: { kind: 'write', approval: ASKS_IN_REVIEW },
      exitplanmode: { kind: 'execute', approval: ASKS_IN_REVIEW },
      exitworktree: { kind: 'write', approval: ASKS_IN_REVIEW },
      glob: { kind: 'read', approval: ASKS_NEVER },
      grep: { kind: 'read', approval: ASKS_NEVER },
      killshell: { kind: 'execute', approval: ASKS_IN_REVIEW },
      listagents: { kind: 'read', approval: ASKS_NEVER },
      listmcpresourcestool: { kind: 'read', approval: ASKS_NEVER },
      ls: { kind: 'read', approval: ASKS_NEVER },
      lsp: { kind: 'read', approval: ASKS_NEVER },
      monitor: { kind: 'execute', approval: ASKS_IN_REVIEW },
      multiedit: { kind: 'write', approval: ASKS_IN_REVIEW },
      notebookedit: { kind: 'write', approval: ASKS_IN_REVIEW },
      powershell: { kind: 'execute', approval: ASKS_IN_REVIEW },
      pushnotification: { kind: 'network', approval: ASKS_IN_REVIEW },
      read: { kind: 'read', approval: ASKS_NEVER },
      readmcpresourcetool: { kind: 'read', approval: ASKS_NEVER },
      remotetrigger: { kind: 'network', approval: ASKS_IN_REVIEW },
      reportfindings: { kind: 'write', approval: ASKS_IN_REVIEW },
      schedulewakeup: { kind: 'write', approval: ASKS_IN_REVIEW },
      sendfeedback: { kind: 'write', approval: ASKS_IN_REVIEW },
      sendmessage: { kind: 'execute', approval: ASKS_IN_REVIEW },
      senduserfile: { kind: 'network', approval: ASKS_IN_REVIEW },
      shareonboardingguide: { kind: 'network', approval: ASKS_IN_REVIEW },
      skill: { kind: 'execute', approval: ASKS_IN_REVIEW },
      subagenthandback: { kind: 'execute', approval: ASKS_IN_REVIEW },
      task: { kind: 'execute', approval: ASKS_IN_REVIEW },
      taskcreate: { kind: 'write', approval: ASKS_IN_REVIEW },
      taskget: { kind: 'read', approval: ASKS_NEVER },
      tasklist: { kind: 'read', approval: ASKS_NEVER },
      taskoutput: { kind: 'read', approval: ASKS_NEVER },
      taskstop: { kind: 'execute', approval: ASKS_IN_REVIEW },
      taskupdate: { kind: 'write', approval: ASKS_IN_REVIEW },
      teamcreate: { kind: 'write', approval: ASKS_IN_REVIEW },
      teamdelete: { kind: 'write', approval: ASKS_IN_REVIEW },
      todowrite: { kind: 'write', approval: ASKS_IN_REVIEW },
      toolsearch: { kind: 'read', approval: ASKS_NEVER },
      waitformcpservers: { kind: 'read', approval: ASKS_NEVER },
      webfetch: { kind: 'network', approval: ASKS_IN_REVIEW },
      websearch: { kind: 'network', approval: ASKS_IN_REVIEW },
      workflow: { kind: 'execute', approval: ASKS_IN_REVIEW },
      write: { kind: 'write', approval: ASKS_IN_REVIEW },
    },
  },
  prefix: 'cc',
  variable: CLAUDE_SESSION.variable,
  exports: [
    'CLAUDECODE',
    'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_EFFORT',
    'CLAUDE_PID',
    'AI_AGENT',
  ],
  binary: 'claude',
  installedIn: (home) => [`${home}/.claude/local`],
  install: 'curl -fsSL https://claude.ai/install.sh | bash',
  metadata: claudeReader,
  launch: {
    permission,
    permissionModes,
    model,
    interactive: (prompt, choice, chosen) => [
      'claude',
      ...(chosen ?? adoptedPermissionArgv(permission)),
      ...chosenModelArgv(model, choice),
      ...prompted(prompt),
    ],
    assign: (key, prompt, choice, chosen) => [
      'claude',
      ...(chosen ?? adoptedPermissionArgv(permission)),
      ...chosenModelArgv(model, choice),
      '--session-id',
      key,
      ...prompted(prompt),
    ],
    resume: (key, prompt, choice, chosen) => [
      'claude',
      ...(chosen ?? adoptedPermissionArgv(permission)),
      ...chosenModelArgv(model, choice),
      '--resume',
      key,
      ...prompted(prompt),
    ],
    root: rootOfArgv('--resume', true),
    cut: claudeCut,
    carry: claudeCarry,
    address: claudeAddress,
  },
  hooks: {
    file: '.claude/settings.json',
    codec: claudeCodec,
    events: CLAUDE_EVENTS,
    user: { folder: ['.claude'], file: 'settings.json', homeEnv: 'CLAUDE_CONFIG_DIR' },
    context: { chars: HOOK_CONTEXT_CHARS, basis: 'reported' },
    promptContext: true,
  },
  setup: { file: '.claude.json', done: 'hasCompletedOnboarding' },
  instructions: {
    file: 'CLAUDE.md',
    imports: (text) => /@(?:\.\/)?AGENTS\.md\b/i.test(text),
    skill: {
      project: '.claude/skills/tagma',
      user: { folder: ['.claude'], file: 'skills/tagma', homeEnv: 'CLAUDE_CONFIG_DIR' },
    },
  },
  mcpTools: 'catalog',
  mcpCallMeta: 'claudecode/toolUseId',
  mcp: { file: { _tag: 'Project', path: '.mcp.json' }, format: 'json', servers: 'mcpServers', fields: { type: 'stdio' } },
  occasionOf: claudeOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: unreported,
  reportsModel: false,
  turnOf: (event) => field(event, 'prompt_id'),
  answerKey: 'last_assistant_message',
  promptKey: 'prompt',
  subjectOf: namedCall,
  filesOf: claudeFiles,
  printedOf: claudePrinted,
  failureOf: stopFailureOf,
  eventKeys: ['hook_event_name', 'hookEventName', 'session_id', 'sessionId', 'prompt_id', 'tool_name', 'toolName', 'notification_type'],
  screenAskOf: claudeScreenAsk,
  promptScreenOf: claudePromptScreen,
  composer: { of: claudeComposer, returns: { clear: [INTERRUPT_KEY], counts: 'breaks' } },
  keysOf: claudeWidgetKeys,
  cancelKeysOf: () => ['esc'],
  interrupt: ['esc'],
  steer: 'step',
  quit: [['esc'], [INTERRUPT_KEY], [...[...'/exit'].map((char): HarnessWidgetKey => ({ _tag: 'char', char })), 'enter']],
  callEnvelopeMs: null,
  ends: { interrupt: 'screen', idle: 'notification', tail: 'final' },
};

const SIGNED_ELSEWHERE = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR',
  'CLAUDECODE',
];

const claudeEnvironment = (directory: string | null): readonly AccountEnvironment[] => [
  directory === null ? { _tag: 'Unset', name: 'CLAUDE_CONFIG_DIR' } : { _tag: 'Set', name: 'CLAUDE_CONFIG_DIR', value: directory },
  ...SIGNED_ELSEWHERE.map((name) => ({ _tag: 'Unset' as const, name })),
];

export const claudeCode: HarnessProvider = {
  ...claudeCodeDescription,
  kind: 'harness',
  auth: 'cli',
  icon,
  harnessLabel: 'Claude Code',
  mark: claudeCodeIcon,
  accounts: claudeAccounts,
  environment: claudeEnvironment,
  asks: { program: claudeCodeProgram },
  accountMode: {
    section: 'claude',
    title: 'Claude',
    default: 'claude',
    id: 'claude',
    label: 'Claude',
    hint: 'Uses the logins of Claude Code on this machine. Claude Code keeps and renews the token.',
    missing: "Claude Code isn't installed",
    defaultPlace: '~/.claude',
  },
  terminal: claudeTerminal,
  acp: claudeAcp(model),
};
