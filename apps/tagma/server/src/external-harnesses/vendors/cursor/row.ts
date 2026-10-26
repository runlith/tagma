import { HARNESS_LABELS } from '../../../threads/contract/wire/harness/names.js';
import { LEGACY_TOOLS } from '../tools.js';
import { UNMEASURED_HOOK_CONTEXT } from '../../contract/service/adapter.js';

import type { HarnessQuestionOption } from '../../../threads/contract/wire/harness/session.js';
import {
  adoptedPermissionArgv,
  chosenModelArgv,
  INTERRUPT_KEY,
  type TerminalHarnessAdapter,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type ScreenAsk,
  type HarnessWidgetKey,
  type HookOccasion,
} from '../../contract/service/adapter.js';
import type { HarnessCall } from '../../contract/wire/call.js';
import { claudeFiles, claudePrinted } from '../../adapter/claudeFormat.js';
import { field, modelField, nested, questionTool, rootOfArgv, sessionIdOf, tail } from '../../adapter/payload.js';
import { oneValue } from '../../adapter/screenAsk.js';
import { icon as CURSOR_MARK } from '@runlith/adapter-cursor/icon';

import { cursorAcp } from './acp.js';

const CURSOR_SELECTED = /^→ (.+)$/;
const CURSOR_UNSELECTED = /^  (.+)$/;
const CURSOR_HINT = /\([^)]+\)$/;
const CURSOR_CANCEL = /\(esc or n\)$/;
const CURSOR_LOADING = /\(loading\)$/;

const CURSOR_IDLE_COMPOSERS = ['Plan, search, build anything', 'Add a follow-up'];
const CURSOR_WORKING_HINT = 'ctrl+c to stop';

const CURSOR_COMPOSER = /^ {2}→(?: (.*))?$/;
const CURSOR_CONTINUED = /^ {4}(\S.*)$/;
const CURSOR_EXIT_ARMED = 'Press Ctrl+C again to exit';
const CURSOR_WORKING_TAIL = /\s{2,}ctrl\+c to stop$/;

const cursorPromptScreen = (lines: readonly string[]): boolean =>
  !lines.some((line) => line.includes(CURSOR_WORKING_HINT)) &&
  lines.some((line) => CURSOR_IDLE_COMPOSERS.some((composer) => line.includes(composer)));

const CURSOR_QUEUE_HINT = 'enter steer';
const CURSOR_QUEUED = /^\s*○ (.+)$/;

const cursorQueued = (lines: readonly string[]): readonly string[] =>
  lines.some((line) => line.includes(CURSOR_QUEUE_HINT)) ? lines.flatMap((line) => CURSOR_QUEUED.exec(line.trimEnd())?.[1] ?? []) : [];

const cursorDraft = (lines: readonly string[]): string | null => {
  const at = lines.findLastIndex((line) => CURSOR_COMPOSER.test(line.trimEnd()));
  if (at < 0) return null;
  const drawn = CURSOR_COMPOSER.exec(lines[at]!.trimEnd())![1] ?? '';
  const first = drawn.replace(CURSOR_WORKING_TAIL, '').trim();
  const rest: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const continued = CURSOR_CONTINUED.exec(line.trimEnd());
    if (continued === null) break;
    rest.push(continued[1]!);
  }
  if (rest.length === 0 && CURSOR_IDLE_COMPOSERS.includes(first)) return null;
  return [first, ...rest].join('\n');
};

const cursorComposer = (lines: readonly string[]): string | null => {
  const queued = cursorQueued(lines);
  const draft = cursorDraft(lines);
  const words = draft === null ? queued : [...queued, draft];
  return words.length === 0 ? null : words.join('\n');
};

const cursorScreenAsk = (lines: readonly string[]): ScreenAsk | null => {
  const match = (line: string): { readonly selected: boolean; readonly label: string } | null => {
    const focused = CURSOR_SELECTED.exec(line);
    if (focused !== null) return { selected: true, label: focused[1]!.trim() };
    const rest = CURSOR_UNSELECTED.exec(line);
    if (rest !== null && rest[1]!.trim() !== '') return { selected: false, label: rest[1]!.trim() };
    return null;
  };
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (match(lines[i]!) !== null) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const options: HarnessQuestionOption[] = [];
  const marked: string[] = [];
  let above = end;
  for (; above >= 0; above -= 1) {
    const drawn = match(lines[above]!);
    if (drawn === null) break;
    options.unshift({ value: drawn.label, label: drawn.label });
    if (drawn.selected) marked.push(drawn.label);
  }
  if (options.length < 2 || !options.every((option) => CURSOR_HINT.test(option.label))) return null;
  if (!CURSOR_CANCEL.test(options.at(-1)!.label)) return null;
  if (options.some((option) => CURSOR_LOADING.test(option.label))) return null;
  const asked = lines.slice(0, above + 1).findLast((line) => line.trim() !== '');
  if (asked === undefined) return null;
  const prompt = asked.trim().replace(/^⚠\s+/, '');
  return {
    kind: 'choice',
    prompt,
    header: null,
    subject: null,
    options,
    selected: marked.length === 1 ? marked[0]! : null,
  };
};

const cursorWidgetKeys = (ask: ScreenAsk, value: string): readonly HarnessWidgetKey[] | null => {
  if (ask.selected === null) return null;
  const from = ask.options.findIndex((option) => option.value === ask.selected);
  const to = ask.options.findIndex((option) => option.value === value);
  if (from < 0 || to < 0) return null;
  const step = to > from ? 'down' : 'up';
  return [...Array.from<HarnessWidgetKey>({ length: Math.abs(to - from) }).fill(step), 'enter'];
};

const permission = { tagma: ['--force'] } as const satisfies HarnessPermissionArgv;

const model: HarnessModelArgv = null;

const cursorSubject = (event: Record<string, unknown>): HarnessCall | null => {
  const subject = field(event, 'command') ?? field(nested(event, 'tool_input'), 'command');
  return subject === null ? null : { id: field(event, 'tool_use_id') ?? field(event, 'toolUseId'), tool: 'bash', subject };
};

const cursorOccasion: HookOccasion = (event) => {
  switch (event.name) {
    case 'sessionStart':
      return 'session-start';
    case 'beforeSubmitPrompt':
      return 'turn-start';
    case 'stop':
    case 'sessionEnd':
      return 'turn-end';
    case 'preToolUse':
      return questionTool(event.tool) ? 'wait' : 'activity';
    case 'postToolUse':
      return 'activity';
    default:
      return 'self-description';
  }
};

export const cursor: TerminalHarnessAdapter = {
  harness: 'cursor',
  tools: LEGACY_TOOLS,
  label: HARNESS_LABELS.cursor,
  mark: CURSOR_MARK,
  prefix: 'cu',
  binary: 'cursor-agent',
  install: 'curl https://cursor.com/install -fsS | bash',
  metadata: 'cursor-terminal',
  acp: cursorAcp,
  launch: {
    permission,
    model,
    interactive: (prompt, choice) => [
      'cursor-agent',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      ...tail(prompt),
    ],
    assign: (key, prompt, choice) => [
      'cursor-agent',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '--resume',
      key,
      ...tail(prompt),
    ],
    resume: (key, prompt, choice) => [
      'cursor-agent',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '--resume',
      key,
      ...tail(prompt),
    ],
    root: rootOfArgv('--resume'),
  },
  hooks: {
    file: '.cursor/hooks.json',
    format: 'cursor',
    events: {
      sessionStart: 'sessionStart',
      preWrite: 'preToolUse',
      postWrite: 'postToolUse',
      postRead: 'postToolUse',
      stop: 'stop',
      agentResponse: 'afterAgentResponse',
      permission: 'beforeShellExecution',
      prompt: 'beforeSubmitPrompt',
      sessionEnd: 'sessionEnd',
    },
    user: { folder: ['.cursor'], file: 'hooks.json' },
    context: UNMEASURED_HOOK_CONTEXT,
  },
  mcpTools: 'proxy',
  mcp: {
    file: { _tag: 'Project', path: '.cursor/mcp.json' },
    format: 'json',
    servers: 'mcpServers',
    approve: (name) => ['cursor-agent', 'mcp', 'enable', name],
  },
  occasionOf: cursorOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: (event) => modelField(event, ['default']),
  reportsModel: true,
  turnOf: (event) => field(event, 'generation_id'),
  answerKey: 'text',
  promptKey: 'prompt',
  subjectOf: cursorSubject,
  filesOf: claudeFiles,
  printedOf: claudePrinted,
  eventKeys: [
    'hook_event_name',
    'hookEventName',
    'session_id',
    'sessionId',
    'generation_id',
    'model',
    'tool_name',
    'toolName',
    'command',
    'status',
  ],
  screenAskOf: cursorScreenAsk,
  promptScreenOf: cursorPromptScreen,
  composer: { of: cursorComposer, returns: { clear: [INTERRUPT_KEY], counts: 'lines' }, drafted: [INTERRUPT_KEY] },
  keysOf: oneValue(cursorWidgetKeys),
  cancelKeysOf: () => ['esc'],
  interrupt: ['esc'],
  exitArm: { key: INTERRUPT_KEY, windowMs: 2_000, banner: CURSOR_EXIT_ARMED, version: '2026.10.19-6bbf2c4' },
  steer: 'none',
  quit: null,
  callEnvelopeMs: null,
  ends: { interrupt: 'record', idle: null, tail: 'prompt' },
};
