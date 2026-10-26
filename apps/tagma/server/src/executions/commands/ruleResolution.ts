import type { CommandRuleCopy, ProgramRuleCopy } from '@runlith/executions/protocol/command';
import {
  limitWords,
  MEASURE_BOUNDS,
  reachOf,
  RULE_TOOLS,
  WAIT_TOOLS,
  type CommandRule,
  type CommandRuleProgram,
  type CommandTime,
  type ProgramRule,
  type RuleMeasure,
  type RuleReach,
} from '../contract/wire/commandRules.js';

const listsOver = (rules: readonly CommandRule[], thread: string): readonly (readonly CommandRule[])[] => [
  rules.filter((rule) => reachOf(rule) === 'machine'),
  rules.filter((rule) => reachOf(rule) === 'project'),
  rules.filter((rule) => rule.thread === thread),
];

const tightest = (decided: readonly CommandRule[]): CommandRule | null =>
  decided.reduce<CommandRule | null>((kept, one) => (kept === null || one.limitMs <= kept.limitMs ? one : kept), null);

const bounds = (rule: CommandRule, tool: string, measure: RuleMeasure): boolean =>
  rule.program === null &&
  rule.measure === measure &&
  (measure === 'wait' ? WAIT_TOOLS : RULE_TOOLS).includes(tool) &&
  (rule.through === null || rule.through === tool);

export function resolveCommandTime(input: {
  readonly rules: readonly CommandRule[];
  readonly thread: string | null;
  readonly tool: string;
  readonly measure: RuleMeasure;
  readonly requested: number | undefined;
}): CommandTime {
  const { defaultMs, ceilingMs } = MEASURE_BOUNDS[input.measure];
  const rule =
    input.thread === null
      ? null
      : tightest(
          listsOver(input.rules, input.thread).flatMap((list) => list.findLast((one) => bounds(one, input.tool, input.measure)) ?? []),
        );
  const asked = input.requested === undefined ? undefined : Math.min(input.requested, ceilingMs);
  if (rule === null) {
    return asked === undefined ? { limitMs: defaultMs, origin: 'default', rule: null } : { limitMs: asked, origin: 'caller', rule: null };
  }
  const ruled = Math.min(rule.limitMs, ceilingMs);
  return asked === undefined || asked > ruled ? { limitMs: ruled, origin: 'rule', rule } : { limitMs: asked, origin: 'caller', rule };
}

const reachesTool = (rule: CommandRule, tool: string): boolean =>
  RULE_TOOLS.includes(tool) && (rule.through === null || rule.through === tool);

export function programRulesOver(input: {
  readonly rules: readonly CommandRule[];
  readonly thread: string | null;
  readonly tool: string;
}): readonly ProgramRule[] {
  if (input.thread === null) return [];
  return listsOver(input.rules, input.thread)
    .flat()
    .filter((rule): rule is ProgramRule => rule.program !== null && reachesTool(rule, input.tool));
}

export const folderEscapes = (folder: string): boolean => {
  if (folder.startsWith('/')) return true;
  let depth = 0;
  for (const part of folder.split('/')) {
    if (part === '..') depth -= 1;
    else if (part !== '' && part !== '.') depth += 1;
    if (depth < 0) return true;
  }
  return false;
};

const segments = (folder: string | undefined): readonly string[] => {
  const kept: string[] = [];
  for (const part of (folder ?? '').split('/')) {
    if (part === '..') kept.pop();
    else if (part !== '' && part !== '.') kept.push(part);
  }
  return kept;
};

const folderWithin = (inner: string | undefined, outer: string | undefined): boolean => {
  const within = segments(inner);
  const around = segments(outer);
  return around.length <= within.length && around.every((part, at) => within[at] === part);
};

const subsequence = (short: readonly string[], long: readonly string[]): boolean => {
  let at = 0;
  for (const word of long) if (at < short.length && word === short[at]) at += 1;
  return at === short.length;
};

const programsOverlap = (left: CommandRuleProgram, right: CommandRuleProgram): boolean =>
  left.words[0] === right.words[0] &&
  (subsequence(left.words.slice(1), right.words.slice(1)) || subsequence(right.words.slice(1), left.words.slice(1))) &&
  (folderWithin(left.folder, right.folder) || folderWithin(right.folder, left.folder));

const overlaps = (left: CommandRule, right: CommandRule): boolean =>
  left.measure === right.measure &&
  (left.through === null || right.through === null || left.through === right.through) &&
  (left.program === null ? right.program === null : right.program !== null && programsOverlap(left.program, right.program));

const LIST_DEPTH: Readonly<Record<RuleReach, number>> = { machine: 0, project: 1, thread: 2 };

const sameList = (left: CommandRule, right: CommandRule): boolean => left.project === right.project && left.thread === right.thread;

const stackedOver = (left: CommandRule, right: CommandRule): boolean =>
  left.project === null ||
  right.project === null ||
  (left.project === right.project && (left.thread === null || right.thread === null || left.thread === right.thread));

export function overridesOf(
  rule: CommandRule,
  rules: readonly CommandRule[],
): { readonly overrides: readonly CommandRule[]; readonly overriddenBy: readonly CommandRule[] } {
  const at = rules.findIndex((one) => one.id === rule.id);
  const beats = (one: CommandRule, index: number): boolean =>
    sameList(one, rule)
      ? index > at
      : one.limitMs < rule.limitMs || (one.limitMs === rule.limitMs && LIST_DEPTH[reachOf(one)] > LIST_DEPTH[reachOf(rule)]);
  const facing = rules.flatMap((one, index) =>
    one.id !== rule.id && stackedOver(one, rule) && overlaps(one, rule) ? [{ one, wins: beats(one, index) }] : [],
  );
  return {
    overrides: facing.filter((pair) => !pair.wins).map((pair) => pair.one),
    overriddenBy: facing.filter((pair) => pair.wins).map((pair) => pair.one),
  };
}

export const ruleCopy = (rule: CommandRule): CommandRuleCopy => ({
  id: rule.id,
  machine: reachOf(rule) === 'machine' ? (true as const) : undefined,
  thread: rule.thread ?? undefined,
  through: rule.through ?? undefined,
  limitMs: rule.limitMs,
  writer: rule.origin.writer,
  at: rule.origin.at,
  words: rule.origin.words,
});

export const programCopy = (rule: ProgramRule): ProgramRuleCopy => ({
  id: rule.id,
  machine: reachOf(rule) === 'machine' ? (true as const) : undefined,
  thread: rule.thread ?? undefined,
  program: {
    words: rule.program.words,
    folder: rule.program.folder,
  },
  limitMs: rule.limitMs,
  writer: rule.origin.writer,
  at: rule.origin.at,
  words: rule.origin.words,
});

export const copyHead = (copy: CommandRuleCopy, measure: RuleMeasure): string =>
  `${copy.id} (${measure} ${limitWords(copy.limitMs)} for ${copy.machine === true ? 'every project' : copy.thread === undefined ? 'the project' : 'this thread'}, "${copy.words}")`;
