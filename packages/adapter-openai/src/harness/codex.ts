import { Predicate, Schema } from 'effect';
import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { codexReader } from './reader.js';

import {
  ASKS_IN_REVIEW,
  ASKS_NEVER,
  adoptedPermissionArgv,
  type TerminalSurface,
  chosenModelArgv,
  INTERRUPT_KEY,
  oneValue,
  typeChoice,
  screenChoices,
  UNMEASURED_HOOK_CONTEXT,
  type FileEffect,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type HarnessPrepare,
  type HarnessCutMaking,
  type PrepareJudgment,
  type PrepareAnswer,
  type PreparedRoot,
  type ScreenAsk,
} from '@runlith/tagma/adapter/harness';
import { CODEX_PROVIDER, codexDescription } from '../models/openai.js';
import { codexAccounts } from '../accounts.js';
import { icon } from '../icon.js';
import { CLAUDE_EVENTS, claudeFiles, claudePrinted, claudeOccasion } from '@runlith/tagma/adapter/claude-hooks';
import { field, modelField, namedCall, nested, patchFiles, rootOfArgv, sessionIdOf, tail } from '@runlith/tagma/adapter/payload';
import { CODEX_SESSION } from './session.js';
import { codexCarry } from './carry.js';
import { codexCodec } from './codec.js';

const CODEX_FOOTER = 'Press enter to confirm or esc to cancel';
const CODEX_SELECTED = /^› (\d+)\. (.+)$/;
const CODEX_UNSELECTED = /^  (\d+)\. (.+)$/;

const CODEX_IDLE_COMPOSER = '› Ask Codex to do anything';
const CODEX_WORKING_HINT = 'esc to interrupt';

const codexPromptScreen = (lines: readonly string[]): boolean =>
  lines.some((line) => line.trim() === CODEX_IDLE_COMPOSER) && !lines.some((line) => line.includes(CODEX_WORKING_HINT));

const CODEX_COMPOSER = /^›(?: (.*))?$/;
const CODEX_FOOTER_ROWS = 3;

const codexComposer = (lines: readonly string[]): string | null => {
  const at = lines.findLastIndex((line) => CODEX_COMPOSER.test(line.trimEnd()));
  if (at < 0) return null;
  const below = lines.slice(at + 1).map((line) => line.trimEnd());
  let end = below.length;
  while (end > 0 && below[end - 1] === '') end -= 1;
  const gap = below.slice(0, end).lastIndexOf('');
  if (gap < 0 || end - gap - 1 > CODEX_FOOTER_ROWS) return null;
  const drawn = [CODEX_COMPOSER.exec(lines[at]!.trimEnd())![1] ?? '', ...below.slice(0, gap).map((line) => line.replace(/^ {2}/, ''))];
  const text = drawn.join('\n').trim();
  return text === '' || `› ${text}` === CODEX_IDLE_COMPOSER ? null : text;
};

const codexScreenAsk = (lines: readonly string[]): ScreenAsk | null => {
  const footer = lines.findLastIndex((line) => line.trim() === CODEX_FOOTER);
  if (footer < 0) return null;
  const choices = screenChoices(
    lines,
    (line) => {
      const drawn = CODEX_SELECTED.exec(line) ?? CODEX_UNSELECTED.exec(line);
      return drawn === null ? null : { value: drawn[1]!, label: drawn[2]!.trim(), selected: CODEX_SELECTED.test(line) };
    },
    footer - 1,
  );
  if (choices === null) return null;
  const { options, selected, above } = choices;
  if (options.length < 2 || options[0]!.value !== '1') return null;
  const asked = lines.slice(0, above + 1).findLast((line) => line.trim() !== '');
  if (asked === undefined) return null;
  const shown = asked.trim();
  const prompt = shown.replace(/^\$ /, '');
  return {
    kind: 'choice',
    prompt,
    header: null,
    subject: shown.startsWith('$ ') ? prompt : null,
    options,
    selected,
  };
};

const permission = { tagma: ['--dangerously-bypass-approvals-and-sandbox'] } as const satisfies HarnessPermissionArgv;

const model: HarnessModelArgv = {
  provider: CODEX_PROVIDER,
  argv: (choice) => [...(choice.rung === null ? [] : ['-c', `model_reasoning_effort=${choice.rung}`]), '-m', choice.model],
};

const codexFiles = (event: Record<string, unknown>): readonly FileEffect[] => {
  const named = claudeFiles(event);
  if (named.length > 0) return named;
  const patch = field(nested(event, 'tool_input'), 'command');
  return patch === null ? [] : patchFiles(patch);
};

const vendorRefused = (method: string, code: number, message: string): PrepareJudgment<never> => ({
  _tag: 'Refuse',
  reason: `${method} was refused by the vendor: ${code} ${message}`,
});

const TURNS_UNAVAILABLE = -32601;

const threadOf = (value: unknown): Record<string, unknown> | null =>
  Predicate.isObject(value) && Predicate.isObject(value.thread) ? value.thread : null;

const ThreadRoot = Schema.Struct({
  thread: Schema.Struct({ id: Schema.NonEmptyString, path: Schema.NonEmptyString, ephemeral: Schema.Boolean, historyMode: Schema.String }),
});

const threadRoot = (method: string, outcome: PrepareAnswer): PrepareJudgment<PreparedRoot> => {
  if (outcome._tag === 'VendorError') return vendorRefused(method, outcome.code, outcome.message);
  const decoded = Schema.decodeUnknownResult(ThreadRoot)(outcome.value);
  if (decoded._tag === 'Failure') return { _tag: 'Refuse', reason: `${method} answered an invalid thread: ${decoded.failure}` };
  const { thread } = decoded.success;
  if (thread.ephemeral) return { _tag: 'Refuse', reason: `${method} answered ephemeral true; only a durable thread resumes` };
  if (thread.historyMode !== 'paginated')
    return {
      _tag: 'Refuse',
      reason: `${method} answered history mode ${JSON.stringify(thread.historyMode)}; the measured road is paginated`,
    };
  return { _tag: 'Accept', value: { id: thread.id, artifact: thread.path } };
};

const ThreadTurns = Schema.Struct({ thread: Schema.Struct({ turns: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })) }) });

const prepare: HarnessPrepare = {
  server: () => ({ program: 'codex', args: ['app-server', '--stdio'] }),
  initialize: {
    request: (client) => ({
      method: 'initialize',
      params: { clientInfo: { name: client.name, version: client.version }, capabilities: { experimentalApi: true } },
    }),
    judge: (outcome) => {
      if (outcome._tag === 'VendorError') return vendorRefused('initialize', outcome.code, outcome.message);
      return Predicate.isObject(outcome.value)
        ? { _tag: 'Accept', value: undefined }
        : { _tag: 'Refuse', reason: 'initialize answered no handshake object' };
    },
  },
  start: {
    request: (workspace) => ({ method: 'thread/start', params: { cwd: workspace } }),
    judge: (outcome) => threadRoot('thread/start', outcome),
  },
  read: {
    request: (threadId) => ({ method: 'thread/read', params: { threadId, includeTurns: true } }),
    judge: (outcome) => {
      if (outcome._tag === 'VendorError') {
        return outcome.code === TURNS_UNAVAILABLE
          ? { _tag: 'Accept', value: undefined }
          : vendorRefused('thread/read', outcome.code, outcome.message);
      }
      const thread = threadOf(outcome.value);
      const turns = thread !== null && Array.isArray(thread.turns) ? thread.turns : null;
      if (turns === null) return { _tag: 'Refuse', reason: 'thread/read carried no turns array' };
      return turns.length === 0
        ? { _tag: 'Accept', value: undefined }
        : { _tag: 'Refuse', reason: `thread/read names ${turns.length} turn(s) standing without a prompt` };
    },
  },
};

const cut: HarnessCutMaking = {
  _tag: 'Prepare',
  server: prepare.server,
  initialize: prepare.initialize,
  fork: {
    request: (ask) => ({
      method: 'thread/fork',
      params: { threadId: ask.root, ...(ask.address === null ? {} : { beforeTurnId: ask.address }) },
    }),
    judge: (outcome) => threadRoot('thread/fork', outcome),
  },
  rows: {
    request: prepare.read.request,
    judge: (outcome) => {
      if (outcome._tag === 'VendorError') return vendorRefused('thread/read', outcome.code, outcome.message);
      const decoded = Schema.decodeUnknownResult(ThreadTurns)(outcome.value);
      return decoded._tag === 'Failure'
        ? { _tag: 'Refuse', reason: 'thread/read carried no ordered turn ids' }
        : { _tag: 'Accept', value: decoded.success.thread.turns.map((turn) => turn.id) };
    },
  },
};

export const codexTerminal: TerminalSurface = {
  tools: {
    names: 'vendor',
    byName: {
      apply_patch: { kind: 'write', approval: ASKS_IN_REVIEW },
      bash: { kind: 'execute', approval: ASKS_IN_REVIEW },
      exec: { kind: 'execute', approval: ASKS_IN_REVIEW },
      exec_command: { kind: 'execute', approval: ASKS_IN_REVIEW },
      write_stdin: { kind: 'execute', approval: ASKS_IN_REVIEW },
      request_permissions: { kind: 'execute', approval: ASKS_IN_REVIEW },
      list_mcp_resources: { kind: 'read', approval: ASKS_NEVER },
      list_mcp_resource_templates: { kind: 'read', approval: ASKS_NEVER },
      read_mcp_resource: { kind: 'read', approval: ASKS_NEVER },
      update_plan: { kind: 'write', approval: ASKS_IN_REVIEW },
      wait_for_environment: { kind: 'read', approval: ASKS_NEVER },
      request_user_input: { kind: 'execute', approval: ASKS_IN_REVIEW },
      request_user_input_async: { kind: 'execute', approval: ASKS_IN_REVIEW },
      send_message_to_user_async: { kind: 'execute', approval: ASKS_IN_REVIEW },
      new_context: { kind: 'execute', approval: ASKS_IN_REVIEW },
      get_context_remaining: { kind: 'read', approval: ASKS_NEVER },
      clockcurr_time: { kind: 'read', approval: ASKS_NEVER },
      clocksleep: { kind: 'read', approval: ASKS_NEVER },
      list_available_plugins_to_install: { kind: 'read', approval: ASKS_NEVER },
      request_plugin_install: { kind: 'write', approval: ASKS_IN_REVIEW },
      test_sync_tool: { kind: 'read', approval: ASKS_NEVER },
      view_image: { kind: 'read', approval: ASKS_NEVER },
      spawn_agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      send_input: { kind: 'execute', approval: ASKS_IN_REVIEW },
      send_message: { kind: 'execute', approval: ASKS_IN_REVIEW },
      followup_task: { kind: 'execute', approval: ASKS_IN_REVIEW },
      resume_agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      wait_agent: { kind: 'read', approval: ASKS_NEVER },
      list_agents: { kind: 'read', approval: ASKS_NEVER },
      close_agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      interrupt_agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      multi_agent_v1send_input: { kind: 'execute', approval: ASKS_IN_REVIEW },
      multi_agent_v1resume_agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      multi_agent_v1wait_agent: { kind: 'read', approval: ASKS_NEVER },
      multi_agent_v1close_agent: { kind: 'execute', approval: ASKS_IN_REVIEW },
      wait: { kind: 'read', approval: ASKS_NEVER },
      tool_search: { kind: 'read', approval: ASKS_NEVER },
      web_search: { kind: 'network', approval: ASKS_IN_REVIEW },
      webrun: { kind: 'network', approval: ASKS_IN_REVIEW },
      image_genimagegen: { kind: 'write', approval: ASKS_IN_REVIEW },
    },
  },
  prefix: 'cx',
  variable: CODEX_SESSION.variable,
  binary: 'codex',
  install: 'npm install -g @openai/codex',
  metadata: codexReader,
  launch: {
    permission,
    model,
    interactive: (prompt, choice) => ['codex', ...adoptedPermissionArgv(permission), ...chosenModelArgv(model, choice), ...tail(prompt)],
    resume: (key, prompt, choice) => [
      'codex',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '-c',
      'tui.resume_cwd=current',
      'resume',
      key,
      ...tail(prompt),
    ],
    root: rootOfArgv('resume'),
    prepare,
    cut: { whole: cut, point: cut },
    carry: codexCarry,
    address: { reads: 'turn', of: (seen) => seen.turn },
  },
  hooks: {
    file: '.codex/hooks.json',
    codec: codexCodec,
    events: { ...CLAUDE_EVENTS, toolFailure: undefined, stopFailure: undefined, notification: undefined },
    user: { folder: ['.codex'], file: 'hooks.json', homeEnv: 'CODEX_HOME' },
    context: UNMEASURED_HOOK_CONTEXT,
    promptContext: true,
  },
  skill: { user: { folder: ['.codex'], file: 'skills/tagma', homeEnv: 'CODEX_HOME' } },
  mcpTools: 'catalog',
  mcp: {
    file: { _tag: 'Home', folder: ['.codex'], file: 'config.toml', homeEnv: 'CODEX_HOME' },
    format: 'toml',
    servers: 'mcp_servers',
    fields: { tool_timeout_sec: 600 },
  },
  occasionOf: claudeOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: (event) => modelField(event),
  reportsModel: true,
  turnOf: (event) => field(event, 'turn_id'),
  answerKey: 'last_assistant_message',
  promptKey: 'prompt',
  subjectOf: namedCall,
  filesOf: codexFiles,
  printedOf: claudePrinted,
  eventKeys: [
    'hook_event_name',
    'hookEventName',
    'session_id',
    'sessionId',
    'turn_id',
    'model',
    'tool_name',
    'toolName',
    'notification_type',
  ],
  screenAskOf: codexScreenAsk,
  promptScreenOf: codexPromptScreen,
  composer: { of: codexComposer },
  keysOf: oneValue(typeChoice),
  cancelKeysOf: () => ['esc'],
  interrupt: ['esc'],
  steer: 'step',
  quit: [['esc'], [INTERRUPT_KEY], [INTERRUPT_KEY]],
  callEnvelopeMs: null,
  ends: { interrupt: 'screen', idle: null, tail: 'prompt' },
};

export const codex: HarnessProvider = {
  ...codexDescription,
  kind: 'harness',
  auth: 'cli',
  icon,
  harnessLabel: 'Codex',
  accounts: codexAccounts,
  accountMode: {
    section: 'codex',
    title: 'Codex',
    default: 'codex',
    id: 'codex',
    label: 'Codex',
    hint: 'Uses your Codex sign-in on this Mac',
    missing: "codex isn't installed",
    defaultPlace: 'Codex default',
  },
  environment: (directory) => [
    directory === null ? { _tag: 'Unset', name: 'CODEX_HOME' } : { _tag: 'Set', name: 'CODEX_HOME', value: directory },
    { _tag: 'Unset', name: 'CODEX_API_KEY' },
    { _tag: 'Unset', name: 'CODEX_ACCESS_TOKEN' },
  ],
  terminal: codexTerminal,
};
