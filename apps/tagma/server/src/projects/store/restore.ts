import type { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { insertRows } from '../../platform/store/rows.js';
import { project } from './table.js';

export type RestoredProject = {
  readonly id: number;
  readonly name: string;
  readonly repoKey: string;
  readonly rootPath: string;
  readonly createdAt: Date;
  readonly global?: boolean;
  readonly removedAt: Date | null;
};

export const restoreProjects = (
  unit: WriteUnit<'machine'>,
  db: StoreDb<'machine'>,
  rows: readonly RestoredProject[],
): Effect.Effect<void, StoreFailure> =>
  insertRows(
    unit,
    db,
    project,
    rows.map(({ id, name, repoKey, rootPath, createdAt, global, removedAt }) => ({
      id,
      name,
      repoKey,
      rootPath,
      createdAt,
      global,
      removedAt,
    })),
  );
