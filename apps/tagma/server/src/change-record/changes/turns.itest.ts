import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../platform/store/units.js';
import { project } from '../../projects/store/table.js';
import { workspaceChange } from '../store/tables.js';
import { turnsOf } from './turns.js';

const layer = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(seededStoreLayer(MachineStore, fixtureMigrations, {}, sharedPool)),
);

const row = (id: string, at: number, state: 'committed' | 'withdrawn', mark: { commit?: string; reason?: string }) => ({
  id,
  projectId: 1,
  holderProjectId: 1,
  holder: 'writer',
  runId: 'run',
  checkout: 'checkout',
  path: id.startsWith('landed') ? 'landed.ts' : 'reverted.ts',
  state,
  origin: 'write' as const,
  at: new Date(at),
  commit: mark.commit ?? null,
  committedAt: mark.commit === undefined ? null : new Date(at + 1),
  reason: mark.reason ?? null,
});

it.live('a turn that landed or lost one path twice answers its newest commit and reason, the later recorded on an equal instant', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.insert(project).values({ id: 1, name: 'turns', repoKey: '/turns', rootPath: '/turns', createdAt: new Date(0) });
    yield* store.db
      .insert(workspaceChange)
      .values([
        row('landed-first', 1_000, 'committed', { commit: 'df4c646d' }),
        row('landed-again', 1_000, 'committed', { commit: '93ebdac0' }),
        row('reverted-first', 1_000, 'withdrawn', { reason: 'reverted' }),
        row('reverted-again', 2_000, 'withdrawn', { reason: 'overwritten' }),
      ]);
    const { rows } = yield* turnsOf(units, store, 1, 'writer', 10);
    expect(
      rows.map(({ path, state, commit, reason }) => ({ path, state, commit, reason })).sort((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([
      { path: 'landed.ts', state: 'committed', commit: '93ebdac0', reason: null },
      { path: 'reverted.ts', state: 'withdrawn', commit: null, reason: 'overwritten' },
    ]);
  }).pipe(Effect.provide(layer)),
);
