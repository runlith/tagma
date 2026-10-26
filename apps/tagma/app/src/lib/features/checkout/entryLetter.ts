import type { CheckoutEntryStatus } from '@tagma/server/workspace/contract/wire/checkout';

export const ENTRY_LETTER: Record<CheckoutEntryStatus, string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  unmerged: '!',
};

export const ENTRY_INK: Record<CheckoutEntryStatus, string> = {
  added: 'text-status-done',
  deleted: 'text-severity-lie',
  modified: 'text-status-in-work',
  renamed: 'text-mutation',
  copied: 'text-mutation',
  untracked: 'text-status-done',
  unmerged: 'text-destructive',
};
