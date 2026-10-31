import { prepareEngine, selectEngine } from '@runlith/sqlite-process/engine';
import { Effect } from 'effect';

export const prepareSqlite = Effect.promise(async () => {
  await prepareEngine();
  selectEngine();
});
