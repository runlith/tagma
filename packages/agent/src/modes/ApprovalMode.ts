import { Data, Duration, Effect, Schema } from 'effect';
import { Registry, type RegistryCollision } from '../registry/Registry';
import type {
  Approval,
  ApprovalAct,
  AskedReason,
  Condition,
  ConditionUse,
  PermissionOutcome,
  PermissionRefusal,
  Raised,
  Rung,
  Timeout,
} from '../permissions/vocabulary';

export const ApprovalModeView = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  icon: Schema.String,
  strictness: Schema.Number,
  elevated: Schema.optional(Schema.Literal(true)),
});
export type ApprovalModeView = typeof ApprovalModeView.Type;

export type ApprovalMode = ApprovalModeView & {
  readonly confirmsWaiting?: true;
  refuses?(act: ApprovalAct): { readonly code: string; readonly reason: string } | null;
};

export class ModeUnknown extends Data.TaggedError('ModeUnknown')<{ readonly id: string; readonly registered: readonly string[] }> {
  override get message(): string {
    return `No approval mode ${this.id} is registered here; the registered modes are ${this.registered.join(', ')}.`;
  }
}

export interface ModeLookup {
  find(id: string): ApprovalMode | undefined;
}

export interface ModeRegistry extends ModeLookup {
  register(owner: string, mode: ApprovalMode): Effect.Effect<() => void, RegistryCollision>;
  get(id: string): Effect.Effect<ApprovalMode, ModeUnknown>;
  declared(): readonly ApprovalModeView[];
}

export type ModeRegistryInput = { readonly owner: string; readonly seed: readonly ApprovalMode[] };

export const makeModeRegistry = ({ owner, seed }: ModeRegistryInput): ModeRegistry => {
  const registry = new Registry(
    'approval mode',
    seed.map((mode) => ({ id: mode.id, owner, value: mode })),
  );
  let views: { readonly revision: number; readonly value: readonly ApprovalModeView[] } | undefined;
  return {
    register: (owner, mode) => registry.register(mode.id, owner, mode),
    get: (id) => {
      const mode = registry.find(id);
      return mode === undefined
        ? Effect.fail(new ModeUnknown({ id, registered: registry.values().map((one) => one.id) }))
        : Effect.succeed(mode);
    },
    find: (id) => registry.find(id),
    declared: () => {
      const revision = registry.revision;
      if (views === undefined || views.revision !== revision) views = { revision, value: registry.values().map(viewOf) };
      return views.value;
    },
  };
};

export function resolveMode(modes: ModeLookup, id: string): ApprovalMode {
  return modes.find(id) ?? absentMode(id);
}

function absentMode(id: string): ApprovalMode {
  const reason = `no approval mode ${id} is registered here.`;
  return { id, label: id, description: reason, icon: '', strictness: 0, refuses: () => ({ code: 'contributor-absent', reason }) };
}

function viewOf(mode: ApprovalMode): ApprovalModeView {
  return {
    id: mode.id,
    label: mode.label,
    description: mode.description,
    icon: mode.icon,
    strictness: mode.strictness,
    elevated: mode.elevated ? (true as const) : undefined,
  };
}

export type ModeOf = (() => ApprovalMode) & { readonly modes: ModeLookup };

export const modeOfLookup = (modes: ModeLookup, id: string | (() => string)): ModeOf =>
  Object.assign(() => resolveMode(modes, typeof id === 'function' ? id() : id), { modes });

export class ConditionUnlisted extends Error {
  constructor(readonly condition: string) {
    super(`The call raised condition ${condition}, which its approval does not list in \`when\`.`);
  }
}

type Cause = {
  readonly id: string;
  readonly text: string;
  readonly asksFrom: Rung;
  readonly timeout: Timeout;
};

export const conditionOf = (use: ConditionUse): Condition => ('condition' in use ? use.condition : use);

const useFor = (
  approval: Approval,
  id: string,
): { readonly condition: Condition; readonly asksFrom: Rung; readonly timeout: Timeout } | null => {
  for (const use of approval.when ?? []) {
    const condition = conditionOf(use);
    if (condition.id === id) return 'condition' in use ? use : { condition, asksFrom: condition.asksFrom, timeout: condition.timeout };
  }
  return null;
};

const strictnessOf = (modes: ModeLookup, rung: Rung): number => modes.find(rung)?.strictness ?? Number.NEGATIVE_INFINITY;

const durationMs = (timeout: Timeout): number | null => (timeout === 'none' ? null : Duration.toMillis(timeout));

export function judge(
  approval: Approval,
  raised: readonly Raised[],
  mode: ApprovalMode,
  modes: ModeLookup,
  act: ApprovalAct,
): PermissionOutcome {
  const refused = mode.refuses?.(act) ?? null;
  if (refused !== null) return { verdict: 'deny', code: refused.code, reason: refused.reason };
  const causes: Cause[] = [];
  if ('timeout' in approval) {
    causes.push({
      id: approval.asksFrom,
      text: approval.why ?? `The ${approval.asksFrom} mode asks before this.`,
      asksFrom: approval.asksFrom,
      timeout: approval.timeout,
    });
  }
  for (const one of raised) {
    const use = useFor(approval, one.condition);
    if (use === null) throw new ConditionUnlisted(one.condition);
    causes.push({ id: one.condition, text: `${use.condition.label}: ${one.fact}`, asksFrom: use.asksFrom, timeout: use.timeout });
  }
  const asking = causes.filter((cause) => strictnessOf(modes, cause.asksFrom) <= mode.strictness);
  if (asking.length === 0) return { verdict: 'allow' };
  const reasons: readonly AskedReason[] = asking.map((cause) => ({ id: cause.id, text: cause.text }));
  const limits = asking.map((cause) => durationMs(cause.timeout)).filter((ms): ms is number => ms !== null);
  return { verdict: 'ask', reasons, timeoutMs: limits.length === 0 ? null : Math.min(...limits) };
}

export function approvalIssues(
  declared: Iterable<{ readonly id: string; readonly approval: Approval }>,
  modes: ModeLookup,
): readonly string[] {
  const owners = new Map<string, { readonly condition: Condition; readonly by: string }>();
  const issues: string[] = [];
  for (const { id, approval } of declared) {
    for (const rung of rungsOf(approval)) {
      if (modes.find(rung) === undefined) issues.push(`${id} asks from ${rung}, which no registered mode names.`);
    }
    for (const use of approval.when ?? []) {
      const condition = conditionOf(use);
      const owner = owners.get(condition.id);
      if (owner === undefined) owners.set(condition.id, { condition, by: id });
      else if (owner.condition !== condition) issues.push(`Condition ${condition.id} is declared separately by ${owner.by} and ${id}.`);
    }
  }
  return issues;
}

export function rungsOf(approval: Approval): readonly Rung[] {
  return [...('timeout' in approval ? [approval.asksFrom] : []), ...(approval.when ?? []).flatMap((use) => [use.asksFrom])];
}

export type ApprovalDescription = {
  readonly asksFrom: Rung;
  readonly timeoutMs: number | null;
  readonly why?: string;
  readonly conditions: readonly {
    readonly id: string;
    readonly label: string;
    readonly asksFrom: Rung;
    readonly timeoutMs: number | null;
  }[];
};

const millisOf = (timeout: Timeout): number | null => (timeout === 'none' ? null : Duration.toMillis(timeout));

export function describeApproval(approval: Approval): ApprovalDescription {
  return {
    asksFrom: approval.asksFrom,
    timeoutMs: 'timeout' in approval ? millisOf(approval.timeout) : null,
    why: 'why' in approval && approval.why !== undefined ? approval.why : undefined,
    conditions: (approval.when ?? []).map((use) => ({
      id: conditionOf(use).id,
      label: conditionOf(use).label,
      asksFrom: use.asksFrom,
      timeoutMs: millisOf(use.timeout),
    })),
  };
}

export function approvalLine(approval: Approval): string {
  if (!('timeout' in approval) && (approval.when ?? []).length === 0) return '';
  const timeoutWords = (timeout: Timeout) =>
    timeout === 'none' ? 'waits for an answer' : `waits ${Duration.toMillis(timeout) / 60_000} minutes`;
  const own = 'timeout' in approval ? `Asks from ${approval.asksFrom}, ${timeoutWords(approval.timeout)}` : 'Asks about nothing on its own';
  const when = (approval.when ?? []).map((use) => `${conditionOf(use).label} (${use.asksFrom})`);
  return when.length === 0 ? `${own}.` : `${own}; also on: ${when.join(', ')}.`;
}

export type ApprovalOutcome =
  | { readonly kind: 'unanswered'; readonly questionId: string; readonly askedOf: string; readonly timeoutMs: number }
  | { readonly kind: 'declined'; readonly by: string; readonly note?: string }
  | { readonly kind: 'approval-pending'; readonly questionId: string }
  | { readonly kind: 'no-approver' }
  | { readonly kind: 'mode-unknown'; readonly id: string };

const spanOf = (ms: number): string => {
  const minutes = ms / 60_000;
  return Number.isInteger(minutes) ? `${minutes} minutes` : `${Math.round(ms / 1000)} seconds`;
};

export function outcomeRefusal(outcome: ApprovalOutcome, action: string): PermissionRefusal {
  switch (outcome.kind) {
    case 'unanswered':
      return {
        status: 'refused',
        code: 'unanswered',
        reason: `${outcome.askedOf} did not answer ${action} within ${spanOf(outcome.timeoutMs)}; question ${outcome.questionId} lapsed.`,
        unblock: [`repeat ${action} to ask again`, 'continue without it'],
      };
    case 'declined':
      return {
        status: 'refused',
        code: 'declined',
        reason: `${outcome.by} declined ${action}${outcome.note === undefined ? '.' : `: ${outcome.note}`}`,
        unblock: ['change the intended act before asking again'],
      };
    case 'approval-pending':
      return {
        status: 'refused',
        code: 'approval-pending',
        reason: `${action} is waiting for an answer; question ${outcome.questionId} stands in this thread and its answer survives this call.`,
        unblock: [`answer question ${outcome.questionId}, then repeat ${action}`],
      };
    case 'no-approver':
      return {
        status: 'refused',
        code: 'no-approver',
        reason: `${action} needs an answer, and this run cannot wait for one.`,
        unblock: ['continue without it', 'ask the operator to run it'],
      };
    case 'mode-unknown':
      return {
        status: 'refused',
        code: 'mode-unknown',
        reason: `No approval mode ${outcome.id} is registered here.`,
        unblock: ['choose a registered mode'],
      };
  }
}

export function permissionRefusal(outcome: PermissionOutcome, action: string): PermissionRefusal {
  if (outcome.verdict === 'deny') return { status: 'refused', code: outcome.code, reason: `${action} is refused: ${outcome.reason}` };
  return outcomeRefusal({ kind: 'no-approver' }, action);
}
