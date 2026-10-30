import { Effect } from 'effect';
import { QuotaUnavailable } from '@runlith/llm/schema/quota';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import {
  adoptedPermissionArgv,
  ASKS_IN_REVIEW,
  ASKS_NEVER,
  UNMEASURED_HOOK_CONTEXT,
  type TerminalSurface,
} from '@runlith/tagma/adapter/harness';
import { accounts } from '../accounts.js';
import { catalog } from '../catalog.js';
import { accountEnvironment } from '../environment.js';
import { installedProgram } from '../host.js';
import { icon } from '../icon.js';
import { claudeCodec, claudeOccasion } from '@runlith/tagma/adapter/claude-hooks';
import { field, modelField, namedCall, rootOfArgv, sessionIdOf } from '@runlith/tagma/adapter/payload';
import { events, filesOf, printedOf } from './format.js';
import plugin from './plugin.ts' with { type: 'text' };
import { opencodeAcp } from './acp.js';
import { OPENCODE_SESSION } from './session.js';

const permission = { tagma: ['--auto'] } as const;
const prompted = (prompt: string | undefined): string[] => (prompt === undefined ? [] : ['--prompt', prompt]);

const terminal: TerminalSurface = {
  prefix: 'oc',
  variable: OPENCODE_SESSION.variable,
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
    codec: claudeCodec,
    events,
    user: { folder: ['.config', 'opencode'], file: 'tagma-hooks.json', homeEnv: 'OPENCODE_CONFIG_DIR' },
    context: UNMEASURED_HOOK_CONTEXT,
    assets: [
      { file: 'plugins/tagma/index.ts', content: plugin as unknown as string },
      { file: 'plugins/tagma/package.json', content: '{"type":"module","exports":{"./server":"./index.ts"}}\n' },
    ],
  },
  skill: { user: { folder: ['.config', 'opencode'], file: 'skills/tagma', homeEnv: 'OPENCODE_CONFIG_DIR' } },
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
};

export const opencode: HarnessProvider = {
  id: 'opencode',
  label: 'OpenCode',
  kind: 'harness',
  auth: 'cli',
  icon,
  harnessLabel: 'OpenCode',
  mark: icon,
  accounts: accounts(installedProgram()),
  catalog,
  quota: {
    fromHeaders: () => null,
    read: () => Effect.fail(new QuotaUnavailable({ reason: 'OpenCode does not expose upstream account quota.' })),
  },
  environment: accountEnvironment,
  dynamicCatalog: true,
  models: {},
  defaultTextModel: '',
  cacheLifetime: { promisedSeconds: null, prior: null },
  accountMode: {
    section: 'opencode',
    title: 'OpenCode',
    default: 'opencode',
    id: 'opencode',
    label: 'OpenCode',
    hint: 'Uses the upstream logins kept by OpenCode in this profile. OpenCode keeps and renews its credentials.',
  },
  terminal,
  acp: opencodeAcp,
};
