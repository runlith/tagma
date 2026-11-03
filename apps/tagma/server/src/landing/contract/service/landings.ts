import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { ShapeRefusal } from '../../../change-record/contract/wire/shape.js';
import type { JudgeRefusalCode } from '../../../enforcement/contract/wire/enforcement.js';
import type { HeldTaskLabel } from '../../../change-record/contract/service/taskLabels.js';
import type { DeriveCommand } from '../../../change-record/contract/wire/derivation.js';

export type SubmitRequest = {
  readonly projectId: number;
  readonly subject?: string;
  readonly body?: string;
  readonly coAuthored: boolean;
  readonly tasks: readonly HeldTaskLabel[];
  readonly paths?: readonly string[];
  readonly everything: boolean;
  readonly withoutFormat?: boolean;
  readonly derive?: readonly DeriveCommand[];
};

export type SubmitFailure =
  | GateRefusal<
      | 'no-record'
      | 'no-branch'
      | 'root-unproven'
      | 'git-unavailable'
      | 'git-not-admitted'
      | 'tree-mid-merge'
      | 'path-unread'
      | 'landing-busy'
      | 'landing-cut'
      | 'commit-unsigned'
      | 'reshape-unreadable'
      | ShapeRefusal
      | JudgeRefusalCode
    >
  | StoreFailure;
