import { Effect } from 'effect';
import type { PreparedHolds, PreparedRemoval } from '../../../change-record/contract/service/prepared.js';
import type { CarriedViolation, JudgeRefusalReport, LandingUnjudged, RuleCrossing, RuleRun, Watched } from './enforcement.js';
import { type Trigger, type TriggerPhase, triggersSaid } from '../../../graph/contract/wire/enforcement.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { CheckSubjectKind } from '../../../platform/contract/wire/operation.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { type TerminalActor } from '../../../executions/contract/wire/terminals.js';

export const CHECK_SUBJECTS = ['tree', 'file', 'head'] as const;

const SUBJECT_PHASES: Readonly<Record<CheckSubjectKind, readonly TriggerPhase[]>> = {
  tree: ['before', 'after'],
  file: ['after'],
  head: ['before', 'after'],
};

export const checkedTriggers = Effect.fnUntraced(function* (
  on: readonly Trigger[],
  subjectOf: (operation: string) => CheckSubjectKind | null,
) {
  const unknown = on.filter((one) => {
    const subject = subjectOf(one.op);
    return subject === null || !SUBJECT_PHASES[subject].includes(one.phase);
  });
  if (unknown.length > 0) {
    return yield* new GateRefusal('trigger-unknown', `no operation gives a check what ${triggersSaid(unknown)} would judge`, [
      'name submit_work or merge_worktree, before or after; edit or write, after; or an operation that changes nothing, before or after',
    ]);
  }
  return on;
});

export const GIT_COMMIT = 'git_commit';

export const LANDING_TRIGGER = 'submit_work';

export const COMMIT_OPERATIONS: readonly string[] = [GIT_COMMIT, 'commit_checkout'];

export type JudgedLine = { readonly file: string; readonly line: number };

export type LineHolders = (lines: readonly JudgedLine[]) => Effect.Effect<readonly (readonly string[])[], GateRefusal<'walk-cut'>>;

export type LineRemovers = (lines: readonly JudgedLine[]) => Effect.Effect<readonly PreparedRemoval[], GateRefusal<'walk-cut'>>;

export type TreeSubject = {
  readonly kind: 'tree';
  readonly projectId: number;
  readonly root: string;
  readonly commonDir?: string;
  readonly rulesAt?: string;
  readonly checkout?: string;
  readonly base: string;
  readonly built: string;
  readonly merged?: readonly string[];
  readonly debtBase?: string;
  readonly paths: readonly string[];
  readonly holders?: LineHolders;
  readonly removers?: LineRemovers;
  readonly holds?: PreparedHolds;
  readonly caller?: TerminalActor;
  readonly job?: string;
  readonly branch?: string | null;
};

export type FileSubject = {
  readonly kind: 'file';
  readonly projectId: number;
  readonly root: string;
  readonly paths: readonly string[];
  readonly caller?: TerminalActor;
};

export type HeadSubject = {
  readonly kind: 'head';
  readonly projectId: number;
  readonly root?: string;
  readonly branch?: string | null;
  readonly caller?: TerminalActor;
};

export type StagedSubject = {
  readonly kind: 'staged';
  readonly projectId: number;
  readonly root: string;
  readonly index?: string;
  readonly gate: boolean;
  readonly caller?: TerminalActor;
};

export type CommitSubject = {
  readonly kind: 'commit';
  readonly projectId: number;
  readonly root: string;
  readonly commit: string;
  readonly caller?: TerminalActor;
};

export type CheckSubject = TreeSubject | FileSubject | HeadSubject | StagedSubject;

export type LandedTree = {
  readonly kind: 'tree';
  readonly projectId: number;
  readonly root: string;
  readonly commit: string;
  readonly paths: readonly string[];
  readonly base?: string;
  readonly caller?: TerminalActor;
  readonly carried?: readonly CarriedViolation[];
  readonly told?: true;
};

export type AfterSubject = LandedTree | FileSubject | HeadSubject;

export type AfterDelivery = { readonly delivered: false; readonly reason: string };

export type EscapeNotice = {
  readonly projectId: number;
  readonly threadId: string;
  readonly id: string;
  readonly text: string;
};

export const RULE_ESCAPED_SIGNAL = 'rule-escaped';

export type JudgedTree = {
  readonly projectId: number;
  readonly root: string;
  readonly base: string;
  readonly built: string;
  readonly merged?: readonly string[];
  readonly paths: readonly string[];
  readonly branch?: string | null;
};

export type Checked = {
  readonly refused: JudgeRefusalReport | null;
  readonly watched: readonly Watched[];
  readonly carriedViolations: readonly CarriedViolation[];
  readonly rechecked?: readonly RuleCrossing[];
  readonly unjudged: readonly LandingUnjudged[];
  readonly crossed?: readonly RuleCrossing[];
  readonly runs?: readonly RuleRun[];
  readonly tree?: JudgedTree;
};

export const UNCHECKED: Checked = { refused: null, watched: [], carriedViolations: [], unjudged: [] };

export const OPERATOR_HOLDER = 'operator';

export const holderOf = (caller: TerminalActor | undefined): string =>
  caller?._tag === 'Thread' ? caller.threadId : caller?._tag === 'Foreign' ? principalOf(caller) : OPERATOR_HOLDER;

export const passed = (checked: Checked): Effect.Effect<Checked, GateRefusal<JudgeRefusalReport['code']>> =>
  checked.refused === null
    ? Effect.succeed(checked)
    : Effect.fail(new GateRefusal(checked.refused.code, checked.refused.reason, checked.refused.unblock, undefined, checked.refused.words));
