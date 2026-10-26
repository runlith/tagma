import { Schema } from 'effect';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';

export const graphRecoverySchema = Schema.Struct({
  id: Schema.String,
  treeRoot: Schema.String,
  path: Schema.String,
  branch: Schema.String,
  incoming: Schema.String,
  base: Schema.String,
  theirs: Schema.String,
  createdAt: Schema.String,
  conflicts: Schema.Array(Schema.String),
  threadId: Schema.NullOr(Schema.String),
});

export type GraphRecovery = typeof graphRecoverySchema.Type;

export const unreadableRecoverySchema = Schema.Struct({ file: Schema.String, error: refusalSchema });
export type UnreadableRecovery = typeof unreadableRecoverySchema.Type;

export const recoveryNoticeSchema = Schema.Struct({
  recovery: Schema.NullOr(graphRecoverySchema),
  total: Schema.Int,
  unreadable: Schema.Array(unreadableRecoverySchema),
});
export type RecoveryNotice = typeof recoveryNoticeSchema.Type;

export type RecoveryAim = {
  readonly projectId: number;
  readonly cwd?: string;
  readonly branch?: string;
};
