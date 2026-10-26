import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';

export const worktreeFolder = settingKey({
  id: 'worktrees.folder',
  order: 850,
  title: 'Folder',
  description:
    "The absolute directory a worktree named without a destination is made under, in a folder of the project's name; empty uses worktrees/ beside Tagma's own data, outside every repository.",
  schema: Schema.String.check(Schema.isPattern(/^(?:|\/.*)$/u)),
  fallback: '',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const worktreeBranchPrefix = settingKey({
  id: 'worktrees.branchPrefix',
  order: 860,
  title: 'Branch prefix',
  description: 'What the name of every branch Tagma makes for a new worktree begins with.',
  schema: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._/-]*$/u)),
  fallback: 'tagma/',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const worktreeSetupCopy = settingListKey({
  id: 'worktrees.setupCopy',
  order: 870,
  title: 'Setup: files copied',
  description:
    "Glob patterns, relative to the top of the repository's main checkout, of the ignored files a new worktree gets a copy of before its first turn; `*` stays in one folder and `**/` reaches nested ones, and a file the new tree already holds is left as it stands.",
  member: Schema.NonEmptyString,
  fallback: ['.env*'],
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const worktreeSetupRun = settingKey({
  id: 'worktrees.setupRun',
  order: 880,
  title: 'Setup: command',
  description:
    "The repository's setup command, run in each new worktree after files are copied and before its first turn, such as `pnpm install` or `uv sync`; empty runs no command. Changing it affects future worktrees: run setup directly to prepare an existing checkout.",
  schema: Schema.String,
  fallback: '',
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const WORKTREE_SETTING_KEYS = [worktreeFolder, worktreeBranchPrefix, worktreeSetupCopy, worktreeSetupRun] as const;

export const WORKTREE_SETTING_SECTIONS = [
  {
    id: 'worktrees',
    order: 130,
    title: 'Worktrees',
    description: 'Where the checkouts Tagma makes for this project stand, and what readies a new one before its first turn.',
  },
] as const;
