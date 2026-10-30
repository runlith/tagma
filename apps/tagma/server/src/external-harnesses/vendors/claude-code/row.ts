import { HOOK_CONTEXT_CHARS } from '../../contract/service/adapter.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { HARNESS_LABELS } from '../../../threads/contract/wire/harness/names.js';

import { CLAUDE_CODE_PROVIDER } from '@runlith/adapter-anthropic/models/anthropic';
import { claudeCodeIcon } from '@runlith/adapter-anthropic/icon';
import {
  adoptedPermissionArgv,
  chosenModelArgv,
  INTERRUPT_KEY,
  type TerminalHarnessAdapter,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type HarnessPermissionModes,
  type HarnessWidgetKey,
} from '../../contract/service/adapter.js';
import { claudeScreenAsk, claudeWidgetKeys } from './screen.js';
import { claudeComposer, claudePromptScreen } from './composer.js';
import { CLAUDE_EVENTS, claudeFiles, claudePrinted, claudeOccasion } from '../../adapter/claudeFormat.js';
import { field, namedCall, rootOfArgv, sessionIdOf, unreported } from '../../adapter/payload.js';
import { claudeAcp } from './acp.js';
import { claudeAddress, claudeCut } from './cut.js';
import { stopFailureOf } from './failure.js';
import { claudeCarry } from './carry.js';
import { SESSION_VARIABLES } from '../../contract/wire/sessionVariables.js';

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

export const claudeCode: TerminalHarnessAdapter = {
  harness: 'claude-code',
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
  label: HARNESS_LABELS['claude-code'],
  mark: claudeCodeIcon,
  prefix: 'cc',
  variable: SESSION_VARIABLES['claude-code'],
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
  metadata: 'claude-jsonl',
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
    format: 'claude-code',
    events: CLAUDE_EVENTS,
    user: { folder: ['.claude'], file: 'settings.json', homeEnv: 'CLAUDE_CONFIG_DIR' },
    context: { chars: HOOK_CONTEXT_CHARS, basis: 'reported' },
    promptContext: true,
  },
  setup: { file: '.claude.json', done: 'hasCompletedOnboarding' },
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
  acp: claudeAcp(model),
};
