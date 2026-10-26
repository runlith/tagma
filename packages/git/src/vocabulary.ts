export const SEQUENCER_KINDS = ['merge', 'rebase', 'am', 'cherry-pick', 'revert', 'none'] as const;
export type SequencerKind = (typeof SEQUENCER_KINDS)[number];

export const ENTRY_STATUSES = ['modified', 'added', 'deleted', 'renamed', 'copied', 'untracked', 'unmerged'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_WORDS: Readonly<Record<string, EntryStatus>> = {
  M: 'modified',
  T: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  U: 'unmerged',
};
