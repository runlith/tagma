import { Context, Effect } from 'effect';
import { entryOf } from '@runlith/agent/transcript/kinds';
import { NativeStorage } from '../../../threads/contract/service/engine.js';

export const compactionIn = Effect.fnUntraced(function* (owners: Context.Context<NativeStorage>, threadId: string, turn: string | null) {
  const { threads } = Context.get(owners, NativeStorage);
  const row = yield* threads.find(threadId);
  const entries = turn === null ? [] : yield* threads.entriesOfRun(threadId, turn);
  return { history: row?.history.length ?? 0, entry: entries.findLast(entryOf('compaction')) ?? null };
});
