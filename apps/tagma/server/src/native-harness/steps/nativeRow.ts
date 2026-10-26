import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { isRecord } from './meta.js';

export const nativeRowForm: ThreadFormStep = {
  name: '20261019050100_native_row_meta',
  samples: {
    meta: {
      thread: { id: 't', provider: 'openai-oauth', updatedAt: '2026-08-25T10:00:00.000Z' },
      facet: { contextEventId: 7, harness: null },
    },
  },
  meta: (meta) => {
    if (meta.native !== undefined || meta.record !== undefined || !isRecord(meta.thread)) return null;
    const old = meta.thread;
    const facet = isRecord(meta.facet) ? meta.facet : null;
    if (facet?.harness != null) return null;
    return {
      ...meta,
      native: {
        id: old.id,
        cacheGroup: old.cacheGroup ?? old.id,
        profile: old.profile ?? null,
        pendingInteraction: old.pendingInteraction ?? null,
        account: old.account ?? null,
        provider: old.provider,
        model: old.model ?? null,
        reasoning: old.reasoning ?? null,
        switches: old.switches ?? {},
        systemPrompt: old.systemPrompt ?? null,
        pendingSystemPrompt: old.pendingSystemPrompt ?? null,
        failureReason: old.failureReason ?? null,
        contextReading: old.contextReading ?? null,
        contextEventId: facet?.contextEventId ?? 0,
        worldStateSnapshot: facet?.worldStateSnapshot ?? {},
        worldStateCheckpointId: facet?.worldStateCheckpointId ?? null,
        contextRuns: facet?.contextRuns ?? null,
        updatedAt: old.updatedAt,
      },
    };
  },
};
