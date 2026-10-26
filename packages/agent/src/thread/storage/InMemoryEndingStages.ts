import { Effect } from 'effect';
import { mintCursor, readCursor, type PageQuestion } from '@runlith/paging';
import { EndingStages, type EndingStage, type OwedEnding, type RunEnded } from '../ending';

const STAGES: readonly EndingStage[] = ['settled', 'reported'];

const PENDING: PageQuestion = { operation: 'ending-stages.pending', selection: {}, order: 0 };

type Held = { readonly seq: number; readonly ended: RunEnded; readonly acknowledged: Set<EndingStage> };

export const inMemoryEndingStages = () => {
  const endings = new Map<string, Held>();
  let seq = 0;
  return EndingStages.of({
    record: (ended, unit) =>
      unit.afterCommit(
        Effect.sync(() => {
          if (endings.has(ended.ending)) return;
          seq += 1;
          endings.set(ended.ending, { seq, ended, acknowledged: new Set() });
        }),
      ),

    acknowledge: (ending, stage) =>
      Effect.sync(() => {
        const held = endings.get(ending);
        if (!held) return;
        held.acknowledged.add(stage);
        if (STAGES.every((owed) => held.acknowledged.has(owed))) endings.delete(ending);
      }),

    read: (ending) =>
      Effect.sync(() => {
        const held = endings.get(ending);
        return held ? { ended: held.ended, owed: STAGES.filter((stage) => !held.acknowledged.has(stage)) } : null;
      }),

    pending: (input) =>
      Effect.sync(() => {
        const reading = input.cursor === undefined ? null : readCursor(input.cursor, PENDING);
        const after = reading !== null && 'at' in reading && typeof reading.at[0] === 'number' ? reading.at[0] : 0;
        const owed = [...endings.values()];
        const rows: OwedEnding[] = [];
        let last = after;
        for (const held of owed) {
          if (held.seq <= after) continue;
          if (rows.length === input.limit) break;
          const stage = STAGES.find((candidate) => !held.acknowledged.has(candidate));
          if (stage === undefined) continue;
          rows.push({ ending: held.ended.ending, stage, threadId: held.ended.threadId });
          last = held.seq;
        }
        const more = owed.some((held) => held.seq > last);
        return { rows, total: owed.length, cursor: more ? mintCursor(PENDING, [last]) : null };
      }),
  });
};
