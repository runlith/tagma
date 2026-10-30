import type { InspectionFailure, JudgeRefusalReport, RuleBodies, RuleCrossing } from '../contract/wire/enforcement.js';
import { findingLines } from '../contract/wire/findings.js';
import { MAP_RECOVERY } from '../contract/wire/document.js';
import type { Words } from '../../platform/contract/wire/refusal.js';
import { COMMIT_OPERATIONS } from '../contract/wire/checks.js';

export const MERGE_OP = 'merge_worktree';

export type Rule = { readonly name: string; readonly title: string };

export type Failed = Rule & { readonly why: string; readonly cause: InspectionFailure | 'undecodable'; readonly ways?: readonly string[] };

const withheldNote = (one: RuleCrossing): string =>
  one.withheld === undefined ? '' : `standing only on ${one.withheld}, which this session holds and this change leaves out`;

const failedLine = (one: Failed): string => `${one.name} "${one.title}": ${one.why}`;

const quoted = (title: string): string => `“${title}”`;

const crossedWords = (kind: 'tree' | 'head', crossed: readonly RuleCrossing[]): Words => {
  const blocked = kind === 'head' ? 'HEAD breaks' : 'Blocked by';
  const titles = [...new Map(crossed.map((one) => [one.rule, one.title])).values()];
  const [first, second] = titles;
  if (first === undefined) return { text: `${blocked} a rule` };
  if (second === undefined) return { text: `${blocked} rule ${quoted(first)}` };
  const more = titles.length > 2 ? ` and ${titles.length - 2} more` : '';
  return { text: `${blocked} ${titles.length} rules: ${quoted(first)}, ${quoted(second)}${more}` };
};

const failedWords = (failed: readonly Failed[]): Words => {
  const [first] = failed;
  return {
    text:
      first === undefined || failed.length > 1
        ? `${failed.length} rules could not check this change`
        : `Rule ${quoted(first.title)} could not check this change`,
  };
};

const committing = (op: string): boolean => COMMIT_OPERATIONS.includes(op);

const actSaid = (op: string, kind: 'tree' | 'head'): string =>
  kind === 'head' ? `${op} at HEAD` : op === MERGE_OP ? 'this merge' : committing(op) ? 'this commit' : `this ${op}`;

const firstWay = (op: string, kind: 'tree' | 'head'): string =>
  kind === 'head'
    ? 'fix each violation where it stands at HEAD as its fix says, and land the fix'
    : op === MERGE_OP
      ? "fix each crossing as its fix says on the worktree's branch, commit it there, then merge again"
      : committing(op)
        ? 'fix each crossing as its fix says, or take its path out of the index with `git restore --staged <path>`, then commit again'
        : 'fix each crossing as its fix says, or land the paths that carry none first: submit_work with `paths` naming them';

const absorbWay = (crossed: readonly RuleCrossing[], checkout: string): string => {
  const ruled = new Map<string, Set<string>>();
  for (const one of crossed) ruled.set(one.rule, (ruled.get(one.rule) ?? new Set()).add(one.fingerprint));
  const named = [...ruled].map(
    ([rule, fingerprints]) =>
      `enforce_rule ${rule} with \`checkout\` ${JSON.stringify(checkout)} and \`absorb\` [${[...fingerprints].map((one) => `"${one}"`).join(', ')}]`,
  );
  return `where the code belongs here and the place itself is shaped wrong, do not bend the code to the rule: absorb the crossing as debt — ${named.join('; ')} — owned by a new task that names the area and what you saw, your view that the rule misfits this code included, and name that debt in your answer; the design is that task's`;
};

export const violatedRefusal = (
  op: string,
  kind: 'tree' | 'head',
  crossed: readonly RuleCrossing[],
  failed: readonly Failed[],
  checkout: string,
  bodies: RuleBodies,
): JudgeRefusalReport => {
  const unblock: [string, ...string[]] = [firstWay(op, kind), absorbWay(crossed, checkout)];
  for (const way of new Set(failed.flatMap((one) => one.ways ?? []))) unblock.push(way);
  const withheld = [...new Set(crossed.flatMap((one) => (one.withheld === undefined ? [] : [one.withheld])))];
  if (withheld.length > 0) {
    const one = withheld.length === 1;
    unblock.unshift(
      `${op} with \`paths\` that also names ${withheld.join(', ')}: this session holds ${one ? 'it' : 'them'}, and each crossing standing on ${one ? 'it' : 'them'} ends once ${one ? 'it lands' : 'they land'} in the same commit`,
    );
  }
  const own =
    kind === 'head'
      ? 'HEAD'
      : op === MERGE_OP
        ? "this merge's lines"
        : committing(op)
          ? 'what the index holds'
          : "this session's own lines";
  const act = committing(op) ? 'the commit' : op;
  return {
    code: 'rule-violated',
    reason: [
      `${crossed.length} ${kind === 'head' ? '' : 'new '}crossing${crossed.length === 1 ? '' : 's'} of a gated rule in ${own}, so ${act} did not run:`,
      ...findingLines(crossed, '  ', withheldNote, bodies),
      ...(failed.length === 0 ? [] : [`and a gated inspection could not run: ${failed.map(failedLine).join('; ')}`]),
    ].join('\n'),
    unblock,
    words: crossedWords(kind, crossed),
  };
};

export const failedRefusal = (op: string, kind: 'tree' | 'head', failed: readonly Failed[]): JudgeRefusalReport => {
  if (failed.every((one) => one.cause === 'module-map')) {
    return {
      code: 'module-map-invalid',
      reason: `the module map does not hold together, so ${actSaid(op, kind)} was refused: ${failed.map(failedLine).join('; ')}`,
      unblock: MAP_RECOVERY,
      words: { text: 'The module map does not hold together' },
    };
  }
  const causes = new Set(failed.map((one) => one.cause));
  const unblock: [string, ...string[]] = [
    'check_rules with `rules` naming the rule shows what it reads, what it could not read and how long it takes',
  ];
  if (causes.has('deadline')) {
    unblock.push(
      'a program stopped when its life ran out is given more by the life rule that bound it, in whichever list stands it (read_command_rules, write_command_rule)',
    );
  }
  if (causes.has('worker')) unblock.push('a worker that died twice is started afresh by the next judgement: run the act again');
  if (causes.has('git')) unblock.push("read_checkout says whether git can read this checkout's objects; the gate judges again once it can");
  if (causes.has('envelope')) {
    unblock.push(
      "a subject past the builtin's envelope is never judged: land it in smaller changes, or the rule's owner narrows its reach, or moves it to watch, through enforce_rule",
    );
  }
  if (causes.has('program')) {
    unblock.push("the program's own stderr in the reason says why it failed; its run stands in read_commands under the caller");
  }
  if (causes.has('host'))
    unblock.push('read_commands says whether the execution host stands and takes commands; the gate judges again once it does');
  if (causes.has('caller')) {
    unblock.push(
      op === MERGE_OP
        ? 'a merge queued before its caller was stored has no caller to run a program as: merge_worktree again, which runs it as you'
        : `this ${op} names no caller to run a program as; run it from a thread`,
    );
  }
  if (causes.has('setup')) {
    unblock.push('the worktree setup of the inspected tree failed: worktrees.setupCopy and worktrees.setupRun ready it');
  }
  for (const way of new Set(failed.flatMap((one) => one.ways ?? []))) unblock.push(way);
  return {
    code: 'inspection-failed',
    reason: `a gated rule could not judge ${actSaid(op, kind)}, and a gate that cannot judge refuses: ${failed.map(failedLine).join('; ')}`,
    unblock,
    words: failedWords(failed),
  };
};
