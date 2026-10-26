import { Clock, Effect, Result } from 'effect';
import type { RequestLanded } from '@runlith/agent/thread/run/requests';
import type { ThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { compositionEntryId } from '@runlith/agent/transcript/entryNames';
import { coreEntry } from '@runlith/agent/transcript/kinds';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { ModelAccess } from '../../providers/contract/service/access.js';
import type { HarnessThreads } from '@runlith/agent/thread/AgentHarness';
import type { ThreadState } from '@runlith/agent/thread/state';
import type { ThreadAggregateStorage } from '@runlith/agent/thread/storage/aggregate';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { instructionSnapshot } from '../turns/instructions.js';
import { turnNotes } from '../turns/message.js';
import { startShare } from '../contract/wire/settings.js';
import { START_ENTRY, type StartEntry, startEntryId } from '../contract/wire/start.js';
import { startCost } from './start.js';

export type StartCardParts<TState extends ThreadState, TTx, TWrite extends TTx = TTx> = {
  readonly records: ThreadRecords['Service'];
  readonly store: ThreadAggregateStorage<TTx, TWrite>;
  readonly settings: Settings['Service'];
  readonly models: ModelAccess['Service'];
  readonly compaction: ThreadCompaction<TWrite>;
  readonly threads: HarnessThreads<TState, TTx, TWrite>;
};

export function startCards<TState extends ThreadState, TTx, TWrite extends TTx = TTx>(
  parts: StartCardParts<TState, TTx, TWrite>,
): (landed: RequestLanded) => Effect.Effect<void> {
  const card = Effect.fn('StartCards.card')(function* ({ run, stepNumber }: RequestLanded) {
    if (stepNumber !== 0 || run.provider === null) return;
    const record = yield* parts.records.facts(run.threadId);
    if (record === undefined || record.createdBy !== OPERATOR_PRINCIPAL || record.parentId !== null || record.projectId === null) return;
    const composition = yield* parts.store.entryById(run.threadId, compositionEntryId(run.id));
    if (composition === undefined || !coreEntry(composition) || composition.type !== 'composition' || composition.opening !== true) return;
    const history = (yield* parts.store.historyOf(run.threadId)) ?? [];
    const cost = startCost({
      system: composition.system.chars,
      tools: composition.tools.each.map((tool) => ({ chars: tool.chars, deferred: tool.hidden === true })),
      instructions: instructionSnapshot(history, record.projectId) ?? null,
      notes: turnNotes(history, run.id),
    });
    const window = (yield* parts.models.served(run.provider, run.model)).capacity.context;
    const charsPerToken = parts.compaction.charsPerToken(run.provider, run.model);
    const share = yield* parts.settings.value(startShare, record.projectId);
    if (cost.chars <= share * window * charsPerToken) return;
    const entry: StartEntry = {
      type: START_ENTRY,
      id: startEntryId(run.threadId),
      runId: run.id,
      occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      ...cost,
      tokens: Math.round(cost.chars / charsPerToken),
      window,
      share,
      inputTokens: composition.tokens?.total ?? null,
    };
    yield* parts.threads.handle(run.threadId, record.principalId).append([{ kind: START_ENTRY, payload: { entry } }]);
  });
  return (landed) =>
    Effect.flatMap(Effect.result(card(landed)), (written) =>
      Result.isFailure(written)
        ? Effect.logWarning('the start card of a thread was not written', { threadId: landed.run.threadId, failure: written.failure })
        : Effect.void,
    );
}
