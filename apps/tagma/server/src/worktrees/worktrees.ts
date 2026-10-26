import { worktrees as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { branchesAndWorktrees } from './doctrine/branchesAndWorktrees.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { worktreesCapability } from './contract/wire/capability.js';
import { WORKTREES_FEED } from './contract/wire/feed.js';
import { SPACE_SCAN_FEED } from './contract/wire/space.js';
import { WORKTREE_SETTING_KEYS, WORKTREE_SETTING_SECTIONS } from './contract/wire/settings.js';
import { WorktreeRows } from './contract/service/listing.js';
import { PlaceSpace } from './contract/service/space.js';
import type { WorktreeLive } from './contract/service/live.js';
import { WORKTREES_ENTRY_KINDS } from './contract/wire/entryKinds.js';
import { deletedAfterForm } from './steps/deleteAfter.js';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { worktreeRelocation } from './relocation.js';
import { pools } from './capacity.js';

const FEEDS = [WORKTREES_FEED, SPACE_SCAN_FEED] as const;

const live: WorktreeLive = liveOf(FEEDS, async (door) => {
  const { spaceChannel, worktreeChannel } = await import('./listing/channel.js');
  return { ...worktreeChannel(Context.get(door, WorktreeRows)), ...spaceChannel(Context.get(door, PlaceSpace)) };
});

export const worktrees = manifest({
  ...declaration,
  capabilities: [worktreesCapability],
  pools,
  entryKinds: WORKTREES_ENTRY_KINDS,
  formSteps: [deletedAfterForm],
  contributions: RELOCATIONS.of(worktreeRelocation),
  subjects: async () => (await import('./subjects.js')).WORKTREE_SUBJECTS,
  bodies: async () => {
    const [{ CREATION_PAIRS }, { LISTING_PAIRS }, { RETIREMENT_PAIRS }] = await Promise.all([
      import('./operations/creation.js'),
      import('./operations/listing.js'),
      import('./operations/retirement.js'),
    ]);
    return [...Object.values(CREATION_PAIRS), ...Object.values(LISTING_PAIRS), ...Object.values(RETIREMENT_PAIRS)];
  },
  tables: async () => {
    const [{ worktree, worktreeMerge, worktreeState, worktreeDeletion, worktreeOperation }] = await Promise.all([
      import('./store/tables.js'),
    ]);
    return { entities: [worktree, worktreeMerge, worktreeState], history: [worktreeOperation, worktreeDeletion] };
  },
  live,
  sections: [
    {
      id: 'branches-and-worktrees',
      place: { prompt: 80, law: 60 },
      owner: 'worktrees',
      render: branchesAndWorktrees,
      path: 'src/worktrees/doctrine/branchesAndWorktrees.ts',
      when: 'checkout',
    },
  ],
  settings: [...WORKTREE_SETTING_KEYS],
  settingSections: [...WORKTREE_SETTING_SECTIONS],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ worktreeRecordsLayer }) => worktreeRecordsLayer,
    ),
    workspace: lazyLayer(
      () => import('./lifetime.js'),
      ({ worktreeOwnersLayer }) => worktreeOwnersLayer,
    ),
  },
});
