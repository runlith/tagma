import type { BlockChange, MarkKind } from '@tagma/server/graph/contract/wire/reads';

export const MARK_SIGN: Record<MarkKind, string> = {
  added: '+',
  deleted: '−',
  restored: '↺',
  moved: '→',
  edited: '',
};

export const MARK_TEXT: Record<MarkKind, string> = {
  added: 'text-status-done',
  deleted: 'text-severity-lie',
  restored: 'text-status-verified',
  moved: 'text-status-in-work',
  edited: 'text-brand',
};

export const MARK_EDGE: Record<MarkKind, string> = {
  added: 'border-status-done',
  deleted: 'border-severity-lie',
  restored: 'border-status-verified',
  moved: 'border-status-in-work',
  edited: 'border-brand',
};

export const MARK_LABEL: Record<MarkKind, string> = {
  added: 'Created here',
  deleted: 'Moved to the trash',
  restored: 'Restored from the trash',
  moved: 'Moved in the tree',
  edited: 'Changed',
};

export const CHANGE_TONE: Record<BlockChange['kind'], 'add' | 'remove' | 'plain'> = {
  anchor: 'add',
  unanchor: 'remove',
  relocate: 'plain',
  link: 'add',
  unlink: 'remove',
  supersede: 'remove',
  unsupersede: 'add',
  delete: 'remove',
  restore: 'add',
  enable: 'add',
  disable: 'remove',
  enforce: 'plain',
  remeasure: 'plain',
  settle: 'plain',
  answer: 'add',
  unanswer: 'remove',
  move: 'plain',
  fields: 'plain',
};
