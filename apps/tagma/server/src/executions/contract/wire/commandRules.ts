import { type PageFamily, pageCeiling } from '@runlith/paging';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '@runlith/agent/ToolOutputSpool';
import { Schema } from 'effect';
import type { LimitProvenance } from '@runlith/executions/protocol/command';
import { COMMAND_LIFE, COMMAND_WAIT } from '@runlith/agent-tools/CommandWork';

export const RULE_TOOLS: readonly string[] = ['bash', 'inspection', 'commit-step', 'config'];

export const WAIT_TOOLS: readonly string[] = ['bash'];

export const RULE_MEASURES = ['wait', 'life'] as const;

export const RuleMeasure = Schema.Literals(RULE_MEASURES);

export type RuleMeasure = typeof RuleMeasure.Type;

export const MEASURE_BOUNDS: Readonly<Record<RuleMeasure, { readonly defaultMs: number; readonly ceilingMs: number }>> = {
  wait: COMMAND_WAIT,
  life: COMMAND_LIFE,
};

export const RULE_WORDS_MAX = 190;

export const PROGRAM_WORDS_MAX = 4;

export const PROGRAM_WORD_MAX = 32;

export const PROGRAM_FOLDER_MAX = 64;

export const CommandRuleProgram = Schema.Struct({
  words: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isMaxLength(PROGRAM_WORD_MAX))).check(
    Schema.isMaxLength(PROGRAM_WORDS_MAX),
  ),
  folder: Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(PROGRAM_FOLDER_MAX))),
});

export type CommandRuleProgram = typeof CommandRuleProgram.Type;

export const CommandRuleProvenance = Schema.Struct({
  writer: Schema.String,
  at: Schema.String,
  words: Schema.String,
});

export type CommandRuleProvenance = typeof CommandRuleProvenance.Type;

export const CommandRule = Schema.Struct({
  id: Schema.String,
  project: Schema.NullOr(Schema.Int),
  thread: Schema.NullOr(Schema.String),
  through: Schema.NullOr(Schema.String),
  program: Schema.NullOr(CommandRuleProgram),
  measure: RuleMeasure,
  limitMs: Schema.Int,
  origin: CommandRuleProvenance,
});

export type CommandRule = typeof CommandRule.Type;

export const CommandRuleWritten = Schema.Struct({
  rule: CommandRule,
  overrides: Schema.Array(CommandRule),
  overridesTotal: Schema.Int,
  overriddenBy: Schema.Array(CommandRule),
  overriddenByTotal: Schema.Int,
});

export type CommandRuleWritten = typeof CommandRuleWritten.Type;

export const RULE_REACHES = ['machine', 'project', 'thread'] as const;

export type RuleReach = (typeof RULE_REACHES)[number];

export const CommandRuleListAnswer = Schema.Struct({
  reach: Schema.Literals(RULE_REACHES),
  project: Schema.NullOr(Schema.Int),
  over: Schema.NullOr(Schema.String),
  rules: Schema.Array(CommandRule),
  shown: Schema.Int,
  total: Schema.Int,
  next: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});

export type CommandRuleListAnswer = typeof CommandRuleListAnswer.Type;

export type RuleList = {
  readonly projectId: number | null;
  readonly thread: string | null;
  readonly words: string;
};

export const RULE_POSITIONS = ['start', 'end', 'before', 'after'] as const;

export type RulePosition =
  | { readonly at: 'start' }
  | { readonly at: 'end' }
  | { readonly at: 'before'; readonly anchor: string }
  | { readonly at: 'after'; readonly anchor: string };

export const limitWords = (ms: number): string =>
  ms % 3_600_000 === 0
    ? `${ms / 3_600_000} h`
    : ms % 60_000 === 0
      ? `${ms / 60_000} min`
      : ms % 1_000 === 0
        ? `${ms / 1_000} s`
        : `${ms} ms`;

const programWords = (program: CommandRuleProgram): string =>
  `program "${program.words.join(' ')}"${program.folder === undefined ? '' : ` in ${program.folder}`}`;

export const reachOf = (rule: Pick<CommandRule, 'project' | 'thread'>): RuleReach =>
  rule.thread !== null ? 'thread' : rule.project === null ? 'machine' : 'project';

const reachWords = (rule: CommandRule): string =>
  rule.thread !== null ? `thread ${rule.thread}` : rule.project === null ? 'machine' : `project ${rule.project}`;

export const ruleHead = (rule: CommandRule): string =>
  [
    rule.id,
    reachWords(rule),
    rule.through ?? 'any tool',
    ...(rule.program === null ? [] : [programWords(rule.program)]),
    `${rule.measure} ${limitWords(rule.limitMs)}`,
  ].join(' · ');

export const ruleLine = (rule: CommandRule): string =>
  `${ruleHead(rule)} — "${rule.origin.words}" · ${rule.origin.writer} at ${rule.origin.at}`;

const WIDEST_RULE: CommandRule = {
  id: 'ffffffff',
  project: Number.MAX_SAFE_INTEGER,
  thread: '00000000-0000-0000-0000-000000000000',
  through: 'bash',
  program: {
    words: Array.from({ length: PROGRAM_WORDS_MAX }, () => '中'.repeat(PROGRAM_WORD_MAX)) as [string, ...string[]],
    folder: '中'.repeat(PROGRAM_FOLDER_MAX),
  },
  measure: 'life',
  limitMs: Number.MAX_SAFE_INTEGER,
  origin: {
    writer: 'claude-code:00000000-0000-0000-0000-000000000000',
    at: new Date(0).toISOString(),
    words: '中'.repeat(RULE_WORDS_MAX),
  },
};

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

export const COMMAND_RULES: PageFamily = {
  id: 'command-rules',
  order: 1,
  road: 'text',
  rowBytes: { text: bytesOf(`${ruleLine(WIDEST_RULE)}\n`), json: bytesOf(JSON.stringify(WIDEST_RULE)) },
  defaultRows: 'ceiling',
  sample: () => WIDEST_RULE,
};

export const RULE_PAGE_CEILING = pageCeiling(COMMAND_RULES, TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES);

export const RULES_PER_LIST = Math.floor(RULE_PAGE_CEILING / RULE_REACHES.length);

export type CommandTime = {
  readonly limitMs: number;
  readonly origin: LimitProvenance;
  readonly rule: CommandRule | null;
};

export type ProgramRule = CommandRule & { readonly program: CommandRuleProgram };
