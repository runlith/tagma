import type { IntakeRefused } from '@runlith/agent-tools/WorkspaceChanges';
import type { PlaceUnread } from '../../../workspace/contract/service/checkoutPaths.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { GitAnswerInvalid, GitRefused, GitUnreadable } from '@runlith/git/repository';

export type RunFilesFailure =
  | StoreFailure
  | IntakeRefused
  | PlaceUnread
  | GitUnreadable
  | GitAnswerInvalid
  | GitRefused
  | GateRefusal<'file-write-failed' | 'root-unproven' | 'path-outside-tree' | 'graph-path' | 'selection-shape' | 'walk-cut'>;
