import { Effect } from 'effect';
import type { ThreadRecord } from '../thread/record';
import type { ThreadContextReading } from '../thread/rows';
import { DeclaredCollaboration } from './CollaborationConfig';
import { ContextCompaction } from './compaction';
import { ThreadDirectory } from './ThreadDirectory';
import type { ThreadPlaneFailure } from './ThreadPlaneAccess';
import { Threads } from './threads';
import type { AgentSignalContext, WakeCost } from '../agent/contracts';
import { COLD_WAKE_RULE, type ColdRecipient, coldTokens, envelopeContextOf, wakeCostOf } from './wakeCost';

export type WakePrices = { readonly costs: ReadonlyMap<string, WakeCost>; readonly cold: readonly ColdRecipient[] };

export type Wakes = Effect.Success<typeof makeWakes>;

export const makeWakes = Effect.gen(function* () {
  const threads = yield* Threads;
  const directory = yield* ThreadDirectory;
  const collaboration = yield* DeclaredCollaboration;
  const compaction = yield* ContextCompaction;

  const below = Effect.fnUntraced(function* (holder: ThreadRecord, thread: ThreadRecord) {
    if (thread.parentThreadId === holder.id) return true;
    if (thread.id === holder.id || thread.parentThreadId === null) return false;
    return (yield* threads.lineage(thread.id, holder.principal)).ancestors.some((ancestor) => ancestor.id === holder.id);
  });

  const priced = Effect.fnUntraced(function* (
    holder: ThreadRecord,
    recipients: readonly ThreadRecord[],
  ): Effect.fn.Return<WakePrices, ThreadPlaneFailure> {
    const listed = yield* directory.access(holder).list({ ids: recipients.map((recipient) => recipient.id), limit: recipients.length });
    const costs = new Map(
      listed.rows.flatMap((entry) => (entry.life === 'idle' ? [[entry.threadId, wakeCostOf(entry.warmth)] as const] : [])),
    );
    const rule = collaboration?.coldWake === undefined ? COLD_WAKE_RULE : yield* collaboration.coldWake(holder);
    const cold: ColdRecipient[] = [];
    if (!rule.refuse) return { costs, cold };
    for (const recipient of recipients) {
      const cost = costs.get(recipient.id);
      const tokens = cost === undefined ? null : coldTokens(cost, rule);
      if (tokens !== null && (yield* below(holder, recipient))) cold.push({ threadId: recipient.id, name: recipient.name, tokens });
    }
    return { costs, cold };
  });

  const compacting = Effect.fnUntraced(function* (
    holder: ThreadRecord,
    child: ThreadRecord,
  ): Effect.fn.Return<readonly ColdRecipient[], ThreadPlaneFailure> {
    const { cold } = yield* priced(holder, [child]);
    if (cold.length === 0) return cold;
    return (yield* compaction.summarizer(child.id)) === 'own' ? cold : [];
  });

  const contextOf = Effect.fnUntraced(function* (
    thread: ThreadRecord,
    reading?: ThreadContextReading | null,
  ): Effect.fn.Return<AgentSignalContext | undefined, ThreadPlaneFailure> {
    const listed = yield* threads.list({ principal: thread.principal, from: thread.id, ids: [thread.id], limit: 1 });
    const row = listed.rows.find((candidate) => candidate.threadId === thread.id);
    const measured = reading === undefined ? (row?.contextReading ?? null) : reading;
    if (row?.selection == null || measured === null) return undefined;
    const [warmth] = yield* directory.warmth([{ contextReading: measured, ...row.selection }]);
    return envelopeContextOf(wakeCostOf(warmth ?? null));
  });

  return { priced, compacting, contextOf };
});
