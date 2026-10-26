import type { StoreDb } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { SettableScope } from '../../platform/contract/wire/setting.js';
import { insertRows } from '../../platform/store/rows.js';
import { setting } from './table.js';

export type RestoredSetting = {
  readonly id: number;
  readonly scope: SettableScope;
  readonly key: string;
  readonly projectId: number | null;
  readonly value: string | null;
  readonly declined?: boolean;
  readonly updatedAt: Date;
};

export const restoreSettings = (unit: WriteUnit<'machine'>, db: StoreDb<'machine'>, rows: readonly RestoredSetting[]) =>
  insertRows(
    unit,
    db,
    setting,
    rows.map(({ id, scope, key, projectId, value, declined, updatedAt }) => ({ id, scope, key, projectId, value, declined, updatedAt })),
  );
