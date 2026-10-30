import type { HarnessProvider } from '@runlith/tagma/adapter/provider';
import { devinReader } from './reader.js';
import { devinDescription, DEVIN_PROVIDER } from '../models/devin.js';
import { icon } from '../icon.js';
import {
  adoptedPermissionArgv,
  chosenModelArgv,
  LEGACY_TOOLS,
  oneValue,
  navigateChoice,
  screenChoices,
  UNMEASURED_HOOK_CONTEXT,
  type HarnessModelArgv,
  type TerminalSurface,
  type HarnessPermissionArgv,
  type ScreenAsk,
} from '@runlith/tagma/adapter/harness';
import { CLAUDE_EVENTS, claudeFiles, claudePrinted, claudeOccasion, claudeSubject } from '@runlith/tagma/adapter/claude-hooks';
import { field, rootOfArgv, sessionIdOf, unreported } from '@runlith/tagma/adapter/payload';
import { devinAcp } from './acp.js';
import { devinCodec } from './codec.js';

const FOOTER = '↑↓ select · ↵ confirm · esc cancel';
const OPTION = /^(❭|·) (\d+) (.+)$/;
const CURSOR = '❭';
const BULLET = '⏺ ';

const DEVIN_SUBJECT_LEADS = ['Running command: ', 'Fetching '] as const;

const DEVIN_IDLE_COMPOSER = 'Ask Devin to build features, fix bugs, or work on your code';
const DEVIN_WORKING_HINTS = /esc (twice|again) to interrupt|Guide Devin while it works/;

const devinPromptScreen = (lines: readonly string[]): boolean =>
  lines.some((line) => line.includes(DEVIN_IDLE_COMPOSER)) && !lines.some((line) => DEVIN_WORKING_HINTS.test(line));

const DEVIN_RULE = /^─{3,}(?: \(.+\) ─)?$/;
const DEVIN_COMPOSER = /^❭(?: (.*))?$/;
const DEVIN_PLACEHOLDERS: ReadonlySet<string> = new Set([
  DEVIN_IDLE_COMPOSER,
  'Guide Devin while it works',
  'Press Enter to send queued messages now',
]);

const devinComposer = (lines: readonly string[]): string | null => {
  const below = lines.findLastIndex((line) => DEVIN_RULE.test(line.trim()));
  const above = below < 0 ? -1 : lines.slice(0, below).findLastIndex((line) => DEVIN_RULE.test(line.trim()));
  if (above < 0) return null;
  const first = DEVIN_COMPOSER.exec(lines[above + 1]?.trimEnd() ?? '');
  if (first === null) return null;
  const text = [first[1] ?? '', ...lines.slice(above + 2, below).map((line) => line.trim())].join('\n').trim();
  return text === '' || DEVIN_PLACEHOLDERS.has(text) ? null : text;
};

const devinScreenAsk = (lines: readonly string[]): ScreenAsk | null => {
  const footer = lines.findLastIndex((line) => line.trim() === FOOTER);
  if (footer < 0) return null;
  const choices = screenChoices(
    lines,
    (line) => {
      const drawn = OPTION.exec(line.trim());
      return drawn === null ? null : { value: drawn[2]!, label: drawn[3]!.trim(), selected: drawn[1] === CURSOR };
    },
    footer - 1,
  );
  if (choices === null) return null;
  const { options, selected, above } = choices;
  if (options.length < 2 || options[0]!.value !== '1') return null;
  let top = above;
  while (top >= 0 && lines[top]!.trim() === '') top -= 1;
  if (top < 0) return null;
  let opened = top;
  while (opened >= 0 && lines[opened]!.trim() !== '' && !lines[opened]!.trim().startsWith(BULLET)) opened -= 1;
  const wrapped = opened >= 0 && lines[opened]!.trim().startsWith(BULLET);
  const prompt = wrapped
    ? lines
        .slice(opened, top + 1)
        .map((line, at) => (at === 0 ? line.trim().slice(BULLET.length) : line))
        .join('')
        .trim()
    : lines[top]!.trim();
  const named = DEVIN_SUBJECT_LEADS.find((lead) => prompt.startsWith(lead));
  return {
    kind: 'choice',
    prompt,
    header: null,
    subject: named === undefined ? null : prompt.slice(named.length),
    options,
    selected,
  };
};

const permission = {
  tagma: ['--permission-mode', 'dangerous', '--respect-workspace-trust', 'false'],
} as const satisfies HarnessPermissionArgv;

const model: HarnessModelArgv = {
  provider: DEVIN_PROVIDER,
  argv: (choice) => {
    if (choice.rung !== null) {
      throw new Error(`Devin spells no rung of its own; ${choice.rung} must arrive inside the model id, not beside ${choice.model}.`);
    }
    return ['--model', choice.model];
  },
};

export const devinTerminal: TerminalSurface = {
  tools: LEGACY_TOOLS,
  prefix: 'dv',
  binary: 'devin',
  metadata: devinReader,
  launch: {
    permission,
    model,
    interactive: (prompt, choice) => [
      'devin',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      ...(prompt === undefined ? [] : ['--', prompt]),
    ],
    resume: (key, prompt, choice) => [
      'devin',
      ...adoptedPermissionArgv(permission),
      ...chosenModelArgv(model, choice),
      '--resume',
      key,
      ...(prompt === undefined ? [] : ['--', prompt]),
    ],
    root: rootOfArgv('--resume'),
    export: (argv, path) => {
      const at = argv.includes('--') ? argv.indexOf('--') : argv.length;
      return [...argv.slice(0, at), '--export', path, ...argv.slice(at)];
    },
    witness: (text) => {
      try {
        const named = (JSON.parse(text) as { session_id?: unknown }).session_id;
        return typeof named === 'string' && named.trim().length > 0 ? named.trim() : null;
      } catch {
        return null;
      }
    },
  },
  hooks: {
    file: '.devin/hooks.v1.json',
    codec: devinCodec,
    events: { ...CLAUDE_EVENTS, toolFailure: undefined, stopFailure: undefined, notification: undefined },
    user: null,
    context: UNMEASURED_HOOK_CONTEXT,
  },
  mcpTools: 'catalog',
  mcp: {
    file: { _tag: 'Project', path: '.devin/mcp_config.json' },
    format: 'json',
    servers: 'mcpServers',
    fields: { transport: 'stdio' },
  },
  occasionOf: claudeOccasion,
  sessionKeyOf: sessionIdOf,
  modelOf: unreported,
  reportsModel: false,
  turnOf: (event) => field(event, 'prompt_id'),
  answerKey: 'last_assistant_message',
  promptKey: 'prompt',
  subjectOf: claudeSubject,
  filesOf: claudeFiles,
  printedOf: claudePrinted,
  eventKeys: ['hook_event_name', 'hookEventName', 'session_id', 'sessionId', 'prompt_id', 'tool_name', 'toolName', 'notification_type'],
  screenAskOf: devinScreenAsk,
  promptScreenOf: devinPromptScreen,
  composer: { of: devinComposer },
  keysOf: oneValue(navigateChoice),
  cancelKeysOf: () => ['esc'],
  interrupt: ['esc', 'esc'],
  steer: 'none',
  quit: null,
  callEnvelopeMs: null,
  ends: { interrupt: 'screen', idle: null, tail: 'prompt' },
};

export const devin: HarnessProvider = {
  ...devinDescription,
  kind: 'harness',
  auth: 'cli',
  icon,
  environment: () => [],
  harnessLabel: 'Devin',
  terminal: devinTerminal,
  acp: devinAcp(model),
};
