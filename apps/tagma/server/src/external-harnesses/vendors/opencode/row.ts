import { installedProgram } from '@runlith/adapter-opencode/host';
import { HARNESS_LABELS } from '../../../threads/contract/wire/harness/names.js';
import { UNMEASURED_HOOK_CONTEXT } from '../../contract/service/adapter.js';

import { icon } from '@runlith/adapter-opencode/icon';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { adoptedPermissionArgv, type TerminalHarnessAdapter } from '../../contract/service/adapter.js';
import { claudeOccasion } from '../../adapter/claudeFormat.js';
import { field, modelField, namedCall, rootOfArgv, sessionIdOf } from '../../adapter/payload.js';
import { events, filesOf, printedOf } from './format.js';
import plugin from './plugin.ts' with { type: 'text' };
import { opencodeAcp } from './acp.js';
import { SESSION_VARIABLES } from '../../contract/wire/sessionVariables.js';

const permission = { tagma: ['--auto'] } as const;
const prompted = (prompt: string | undefined): string[] => (prompt === undefined ? [] : ['--prompt', prompt]);

export const opencode: TerminalHarnessAdapter = {
  harness: 'opencode',
  label: HARNESS_LABELS.opencode,
  mark: icon,
  prefix: 'oc',
  variable: SESSION_VARIABLES.opencode,
  binary: installedProgram(),
  launch: {
    permission,
    model: null,
    interactive: (prompt, _choice, chosen) => [
      installedProgram(),
      '--standalone',
      ...(chosen ?? adoptedPermissionArgv(permission)),
      ...prompted(prompt),
    ],
    assign: (key, prompt, _choice, chosen) => [
      installedProgram(),
      '--standalone',
      ...(chosen ?? adoptedPermissionArgv(permission)),
      '--session',
      `ses_${key}`,
      ...prompted(prompt),
    ],
    resume: (key, prompt, _choice, chosen) => [
      installedProgram(),
      '--standalone',
      ...(chosen ?? adoptedPermissionArgv(permission)),
      '--session',
      key,
      ...prompted(prompt),
    ],
    root: rootOfArgv('--session'),
  },
  tools: {
    names: 'vendor',
    byName: {
      shell: { kind: 'execute', approval: ASKS_IN_REVIEW },
      read: { kind: 'read', approval: ASKS_NEVER },
      glob: { kind: 'read', approval: ASKS_NEVER },
      grep: { kind: 'read', approval: ASKS_NEVER },
      edit: { kind: 'write', approval: ASKS_IN_REVIEW },
      write: { kind: 'write', approval: ASKS_IN_REVIEW },
      patch: { kind: 'write', approval: ASKS_IN_REVIEW },
      webfetch: { kind: 'network', approval: ASKS_IN_REVIEW },
      websearch: { kind: 'network', approval: ASKS_IN_REVIEW },
      question: { kind: 'execute', approval: ASKS_IN_REVIEW },
      skill: { kind: 'read', approval: ASKS_NEVER },
      subagent: { kind: 'execute', approval: ASKS_IN_REVIEW },
    },
  },
  hooks: {
    file: '.opencode/tagma-hooks.json',
    format: 'claude-code',
    events,
    user: { folder: ['.config', 'opencode'], file: 'tagma-hooks.json', homeEnv: 'OPENCODE_CONFIG_DIR' },
    context: UNMEASURED_HOOK_CONTEXT,
    assets: [
      { file: 'plugins/tagma/index.ts', content: plugin as unknown as string },
      { file: 'plugins/tagma/package.json', content: '{"type":"module","exports":{"./server":"./index.ts"}}\n' },
    ],
  },
  mcpTools: 'catalog',
  mcp: {
    file: { _tag: 'Home', folder: ['.config', 'opencode'], file: 'opencode.json', homeEnv: 'OPENCODE_CONFIG_DIR' },
    format: 'json',
    servers: ['mcp', 'servers'],
    environment: 'environment',
    declaration: (cli, environment) => ({ type: 'local', command: cli, environment, codemode: false }),
  },
  occasionOf: claudeOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: (event) => modelField(event),
  reportsModel: false,
  turnOf: (event) => field(event, 'prompt_id'),
  answerKey: 'last_assistant_message',
  promptKey: 'prompt',
  subjectOf: namedCall,
  filesOf,
  printedOf,
  eventKeys: ['hook_event_name', 'session_id', 'prompt_id', 'tool_name', 'tool_use_id', 'status'],
  screenAskOf: () => null,
  keysOf: () => null,
  cancelKeysOf: () => null,
  interrupt: ['esc'],
  steer: 'none',
  quit: null,
  callEnvelopeMs: null,
  ends: { interrupt: 'record', idle: null, tail: 'final' },
  acp: opencodeAcp,
};
