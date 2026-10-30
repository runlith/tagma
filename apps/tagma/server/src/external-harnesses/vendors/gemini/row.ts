import { LEGACY_TOOLS } from '../tools.js';
import type { TerminalHarnessAdapter } from '../../contract/service/adapter.js';

import {
  adoptedPermissionArgv,
  chosenModelArgv,
  UNMEASURED_HOOK_CONTEXT,
  type HarnessModelArgv,
  type HarnessPermissionArgv,
  type HarnessQuestionOption,
  type ScreenAsk,
  type HarnessWidgetKey,
  type HookOccasion,
} from '@runlith/tagma/adapter/harness';
import { rootOfArgv, sessionIdOf, tail, unasked, unprinted, unreported, unturned } from '../../adapter/payload.js';
import { claudeFiles } from '../../adapter/claudeFormat.js';
import { oneValue } from '../../adapter/screenAsk.js';
import { GEMINI_MARK } from './mark.js';
import { geminiCodec } from './codec.js';

const GEMINI_SELECTED = /^● (\d+)\. (.+)$/;
const GEMINI_UNSELECTED = /^  (\d+)\. (.+)$/;
const GEMINI_CANCEL = /\(esc\)$/;

const geminiScreenAsk = (lines: readonly string[]): ScreenAsk | null => {
  const match = (line: string) => GEMINI_SELECTED.exec(line) ?? GEMINI_UNSELECTED.exec(line);
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
    options.unshift({ value: drawn[1]!, label: drawn[2]!.trim() });
    if (GEMINI_SELECTED.test(lines[above]!)) marked.push(drawn[1]!);
  }
  if (options.length < 2 || options[0]!.value !== '1' || marked.length === 0) return null;
  if (!GEMINI_CANCEL.test(options.at(-1)!.label)) return null;
  const asked = lines.slice(0, above + 1).findLast((line) => line.trim() !== '');
  if (asked === undefined) return null;
  return {
    kind: 'choice',
    prompt: asked.trim(),
    header: null,
    subject: null,
    options,
    selected: marked.length === 1 ? marked[0]! : null,
  };
};

const geminiWidgetKeys = (ask: ScreenAsk, value: string): readonly HarnessWidgetKey[] | null => {
  if (ask.options.every((option) => option.value !== value)) return null;
  return [...value].map((char): HarnessWidgetKey => ({ _tag: 'char', char }));
};

const permission = { tagma: ['--approval-mode', 'yolo'] } as const satisfies HarnessPermissionArgv;

const model: HarnessModelArgv = null;

const geminiOccasion: HookOccasion = (event) => {
  switch (event.name) {
    case 'SessionStart':
      return 'session-start';
    case 'BeforeAgent':
      return 'turn-start';
    case 'BeforeTool':
    case 'AfterTool':
      return 'activity';
    case 'AfterAgent':
    case 'SessionEnd':
      return 'turn-end';
    case 'Notification':
      return event.notification === 'ToolPermission' ? 'wait' : 'self-description';
    default:
      return 'self-description';
  }
};

export const gemini: TerminalHarnessAdapter = {
  harness: 'gemini',
  tools: LEGACY_TOOLS,
  label: 'Gemini CLI',
  mark: GEMINI_MARK,
  prefix: 'gm',
  binary: 'gemini',
  install: 'npm install -g @google/gemini-cli',
  launch: {
    permission,
    model,
    interactive: (prompt, choice) => ['gemini', ...adoptedPermissionArgv(permission), ...chosenModelArgv(model, choice), ...tail(prompt)],
    resume: (key, prompt, choice) => [
      'gemini',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '--resume',
      key,
      ...tail(prompt),
    ],
    root: rootOfArgv('--resume'),
  },
  hooks: {
    file: '.gemini/settings.json',
    codec: geminiCodec,
    events: {
      sessionStart: 'SessionStart',
      preWrite: 'BeforeTool',
      postWrite: 'AfterTool',
      postRead: 'AfterTool',
      stop: 'AfterAgent',
      permission: null,
      prompt: 'BeforeAgent',
      sessionEnd: 'SessionEnd',
      notification: 'Notification',
    },
    user: { folder: ['.gemini'], file: 'settings.json' },
    context: UNMEASURED_HOOK_CONTEXT,
  },
  mcpTools: 'proxy',
  mcp: { file: { _tag: 'Project', path: '.gemini/settings.json' }, format: 'json', servers: 'mcpServers', fields: { timeout: 600_000 } },
  occasionOf: geminiOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: unreported,
  reportsModel: false,
  turnOf: unturned,
  answerKey: null,
  subjectOf: unasked,
  filesOf: claudeFiles,
  printedOf: unprinted,
  eventKeys: ['hook_event_name', 'hookEventName', 'session_id', 'sessionId', 'notification_type'],
  screenAskOf: geminiScreenAsk,
  keysOf: oneValue(geminiWidgetKeys),
  cancelKeysOf: () => ['esc'],
  interrupt: ['esc'],
  steer: 'none',
  quit: null,
  callEnvelopeMs: null,
  ends: { interrupt: 'screen', idle: null, tail: 'prompt' },
};
