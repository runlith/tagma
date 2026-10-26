import { Context, type Effect } from 'effect';
import type { MergeTree } from '@runlith/git/merge';
import type { MergeDriver } from '@runlith/git/apart';
import type { GitAnswerInvalid, GitRefused, GitUnreadable } from '@runlith/git/repository';
import type { MergeCheck, WorktreeFact } from '../wire/rows.js';

type Failed = GitUnreadable | GitRefused | GitAnswerInvalid;

export type MergeVerdict = { readonly check: MergeCheck; readonly held: boolean; readonly fact: WorktreeFact };

export type MergeChecks = {
  readonly check: (dir: string, base: string, tip: string) => Effect.Effect<MergeTree, Failed>;
  readonly fresh: (dir: string, base: string, tip: string) => Effect.Effect<MergeTree, Failed>;
  readonly holds: (dir: string, base: string, tip: string) => Effect.Effect<boolean, Failed>;
  readonly saved: (dirs: readonly string[]) => Effect.Effect<ReadonlyMap<string, MergeVerdict>, Failed>;
  readonly last: (dir: string, tip: string, currentBase?: string) => Effect.Effect<MergeVerdict, Failed>;
  readonly standing: (dir: string, base: string, tip: string, start: boolean) => Effect.Effect<MergeVerdict, Failed>;
  readonly onTaken: (listener: (dir: string) => void) => () => void;
  readonly forget: (dir: string) => Effect.Effect<void, Failed>;
};

export class CheckDriver extends Context.Service<CheckDriver, MergeDriver & { readonly revision: string }>()('worktrees/CheckDriver') {}

export class CheckPreparation extends Context.Service<
  CheckPreparation,
  {
    readonly revision: string;
    readonly behind: (dir: string, base: string, tip: string) => Effect.Effect<boolean, Failed>;
    readonly prepare: (dir: string, base: string, tip: string) => Effect.Effect<string, Failed>;
  }
>()('worktrees/CheckPreparation') {}
