import { createHash } from 'node:crypto';
import type { CommandPolicyReceipt } from '../contract/wire/commands.js';
import type { ResolvedExecutionTarget } from '../contract/wire/targets.js';
import type { CommandPrograms } from '@runlith/executions/protocol/command';
import { type CommandRule, MEASURE_BOUNDS } from '../contract/wire/commandRules.js';
import { programRulesOver, programCopy, resolveCommandTime, ruleCopy } from './ruleResolution.js';

export type CommandPolicy = {
  readonly rules: readonly CommandRule[];
};

export type PolicyRequest = {
  readonly thread: string | null;
  readonly tool: string;
  readonly requested: number | undefined;
  readonly waitMs?: number;
  readonly root?: string | null;
};

const policyIdentityOf = (policy: CommandPolicy): string =>
  createHash('sha256')
    .update(JSON.stringify({ rules: policy.rules.map((rule) => [rule.id, rule.measure, rule.limitMs]) }), 'utf8')
    .digest('hex');

export function resolveCommandPolicy(policy: CommandPolicy, request: PolicyRequest): CommandPolicyReceipt {
  const time = resolveCommandTime({ ...request, measure: 'life', rules: policy.rules });
  const programs = programsOf(policy.rules, request);
  const ceilingMs = Math.min(time.rule?.limitMs ?? MEASURE_BOUNDS.life.ceilingMs, MEASURE_BOUNDS.life.ceilingMs);
  return {
    limits: { executionMs: time.limitMs, executionCeilingMs: ceilingMs, origin: time.origin },
    policyIdentity: policyIdentityOf(policy),
    time: {
      tool: request.tool,
      requested: request.requested,
      rules: time.rule === null ? [] : [ruleCopy(time.rule)],
      programs: programs,
      life: { ms: time.limitMs, origin: time.origin },
      waitMs: request.waitMs,
    },
  };
}

const programsOf = (rules: readonly CommandRule[], request: PolicyRequest): CommandPrograms | undefined => {
  const root = request.root === undefined || request.root === null || request.root === '' ? undefined : request.root;
  const [first, ...rest] = programRulesOver({ rules, thread: request.thread, tool: request.tool })
    .filter((rule) => root !== undefined || rule.program.folder === undefined)
    .map(programCopy);
  return first === undefined ? undefined : { root: root, rules: [first, ...rest] };
};

const WORKTREE_ROOTS: ReadonlySet<string> = new Set(['worktree', 'worktree-recovered']);

export const programRootOf = (target: ResolvedExecutionTarget): string | null => {
  const holding = target.footprint.roots.filter(
    (overlap) =>
      overlap.relation !== 'descendant' &&
      overlap.root.state === 'active' &&
      (WORKTREE_ROOTS.has(overlap.root.provenance.kind) ||
        (overlap.root.provenance.kind === 'project' && overlap.root.provenance.id === String(target.projectId))),
  );
  const deepest = holding.reduce<(typeof holding)[number] | undefined>(
    (best, overlap) => (best === undefined || overlap.resource.path.length > best.resource.path.length ? overlap : best),
    undefined,
  );
  return deepest?.resource.path ?? null;
};
