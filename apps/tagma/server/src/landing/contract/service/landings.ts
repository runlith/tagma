import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { ShapeRefusal } from '../../../change-record/contract/wire/shape.js';
import type { JudgeRefusalCode } from '../../../enforcement/contract/wire/enforcement.js';
import type { HeldTaskLabel } from '../../../change-record/contract/service/taskLabels.js';
import type { ChangeTaking } from '../../../change-record/contract/wire/handover.js';

export type SubmitTaking = ChangeTaking & { readonly tasks: readonly HeldTaskLabel[] };

export type SubmitRequest = {
  readonly projectId: number;
  readonly subject?: string;
  readonly tasks: readonly HeldTaskLabel[];
  readonly paths?: readonly string[];
  readonly whole?: readonly string[];
  readonly withoutFormat?: boolean;
  readonly taking: readonly SubmitTaking[];
};

export type SubmitFailure =
  | GateRefusal<
      | 'no-record'
      | 'no-branch'
      | 'root-unproven'
      | 'git-unavailable'
      | 'git-not-admitted'
      | 'tree-mid-merge'
      | 'walk-cut'
      | 'lines-held'
      | 'landing-busy'
      | 'landing-cut'
      | 'commit-unsigned'
      | 'reshape-unreadable'
      | ShapeRefusal
      | JudgeRefusalCode
    >
  | StoreFailure;
