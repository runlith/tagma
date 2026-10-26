import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';

export const untrackedCache = settingKey({
  id: 'checkout.untrackedCache',
  order: 840,
  title: 'Untracked cache',
  description:
    "Writes core.untrackedCache=true into this project's repository config, so every git status there — yours, your agents' and Tagma's — rereads only the directories that changed. Off removes only the value Tagma wrote; a value already standing in any git config is never overwritten, and a different one refuses the switch.",
  schema: Schema.Boolean,
  fallback: false,
  scopes: ['project'],
  merge: 'replace',
  installs: true,
});

export const fsmonitor = settingKey({
  id: 'checkout.fsmonitor',
  order: 841,
  title: 'File system monitor',
  description:
    "Writes core.fsmonitor=true into this project's repository config where the installed git carries its own monitor (macOS and Windows builds): a daemon per worktree watches the files, so git status skips scanning what did not move. It pays off in repositories of hundreds of thousands of files; in smaller ones it costs a background process per worktree for little gain. Off removes only the value Tagma wrote and stops the daemon; a value already standing in any git config is never overwritten, and a different one refuses the switch.",
  schema: Schema.Boolean,
  fallback: false,
  scopes: ['project'],
  merge: 'replace',
  installs: true,
});

//! A reading past the 100 ms a person perceives as instant is one the untracked cache would shorten wherever it runs.
export const SLOW_STATUS_MS = 100;

export const offersFastStatus = (reading: { readonly slowStatus: boolean }, on: boolean | undefined, dismissed: boolean): boolean =>
  reading.slowStatus && on === false && !dismissed;

export const CHECKOUT_SETTING_KEYS = [untrackedCache, fsmonitor] as const;

export const CHECKOUT_SETTING_SECTIONS = [
  {
    id: 'checkout',
    order: 125,
    title: 'Git',
    description: "How git reads this project's repository.",
  },
] as const;
