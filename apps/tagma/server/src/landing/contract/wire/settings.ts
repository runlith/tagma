import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey } from '../../../platform/contract/wire/setting.js';

export const coAuthor = settingKey({
  id: 'commits.coAuthor',
  order: 900,
  title: 'Tagma as co-author',
  description:
    'Whether every commit Tagma assembles from agent work — submit_work and the merge or squash commits of a worktree merge — carries `Co-authored-by: Tagma <agent@tagma.dev>`. Author, committer and signature stay yours either way.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const LANDING_SETTING_KEYS = [coAuthor] as const;

export const LANDING_SETTING_SECTIONS = [
  {
    id: 'commits',
    order: 125,
    title: 'Commits',
    description: 'What the commits Tagma assembles from agent work say beside the words the agent wrote.',
  },
] as const;
