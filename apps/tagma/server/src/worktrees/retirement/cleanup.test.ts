import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Git, GitUnavailable } from '@runlith/git/Git';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { WorktreeRow } from '../contract/wire/rows.js';
import { WorktreeRows } from '../contract/service/listing.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';
import { makeCleanupCandidates } from './cleanup.js';

const rootId = RootId.make('idle-root');
const row: WorktreeRow = {
  index: 0,
  missing: false,
  head: null,
  headTime: null,
  stateFact: { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null },
  mergeFact: { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null },
  rootId,
  kind: 'tagma',
  name: 'idle',
  folder: '/checkout/idle',
  branch: 'tagma/idle',
  base: { branch: 'main', commit: 'a'.repeat(40) },
  hue: 1,
  status: 'idle',
  check: 'unknown',
  agents: { working: 0, waiting: 0, finished: 0, standing: 0 },
  ahead: 0,
  behind: 0,
  uncommitted: 0,
  reading: 'done',
  diff: null,
  threads: [],
  setup: 'done',
  taskId: null,
  pending: null,
  movedAt: '2020-01-01T00:00:00.000Z',
};

const git: Git['Service'] = {
  run: (args) => Effect.fail(new GitUnavailable({ command: args, reason: 'repository unreadable' })),
};

it.effect('an unread branch date refuses cleanup before any retirement act', () =>
  Effect.gen(function* () {
    let retired = 0;
    const cleanup = yield* makeCleanupCandidates({ place: () => Effect.succeed({ folder: row.folder, base: null }) }).pipe(
      Effect.provideService(WorktreeRows, { rows: () => Effect.succeed([row]) } as unknown as WorktreeRows['Service']),
      Effect.provideService(Git, git),
      Effect.provideService(WorktreeRetirement, {
        delete: () =>
          Effect.sync(() => {
            retired += 1;
          }).pipe(Effect.andThen(Effect.die('delete must not run'))),
      } as unknown as WorktreeRetirement['Service']),
    );
    const found = yield* Effect.flip(cleanup.candidates(1, 14));
    expect(found.code).toBe('worktree-unavailable');
    const cleaned = yield* Effect.flip(cleanup.clean(1, [rootId], 14));
    expect(cleaned.code).toBe('worktree-unavailable');
    expect(retired).toBe(0);
  }),
);
