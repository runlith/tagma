import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

type Held = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Held => Predicate.isObject(value) && !Array.isArray(value);

export const recordMetaForm: ThreadFormStep = {
  name: '20261019050200_thread_record_meta',
  samples: {
    meta: {
      thread: { id: 't', ownerId: 'o', spawnRootId: 't', agentId: 'tagma', status: 'idle', authority: { mode: 'trust' } },
      facet: { projectId: 1, title: 'past' },
      session: null,
      native: { id: 't' },
      external: null,
    },
  },
  meta: (meta) => {
    if (meta.record !== undefined || !isRecord(meta.thread)) return null;
    const { thread, facet: held, session, ...rest } = meta;
    const facet = isRecord(held) ? held : null;
    const harness = isRecord(facet?.harness) ? ((facet.harness.name as string | undefined) ?? null) : null;
    return {
      ...rest,
      record: {
        id: thread.id,
        projectId: facet?.projectId ?? null,
        origin: facet === null ? 'unscoped' : 'scoped',
        parentId: thread.parentThreadId ?? null,
        spawnRootId: thread.spawnRootId,
        principalId: thread.ownerId,
        name: thread.name ?? null,
        title: facet?.title ?? 'New thread',
        titleOrigin: facet?.titleOrigin ?? 'random',
        titleRevision: facet?.titleRevision ?? 0,
        titleAskedInput: facet?.titleAskedInput ?? null,
        harness: harness ?? 'tagma',
        agentId: thread.agentId,
        bornOf: thread.bornOf ?? null,
        spawnedByRunId: thread.spawnedByRunId ?? null,
        createdBy: thread.createdBy ?? null,
        scopeBlockUuid: facet?.scopeBlockUuid ?? null,
        readerOrderAt: facet?.readerOrderAt ?? thread.createdAt,
        pinnedAt: facet?.pinnedAt ?? null,
        archivedAt: facet?.archivedAt ?? null,
        status: thread.status,
        movedAt: harness === null ? null : thread.updatedAt,
        createdAt: thread.createdAt,
      },
      mandate: {
        id: thread.id,
        authority: thread.authority,
        delegation: facet?.delegation ?? null,
        budgetTokens: thread.budgetTokens ?? null,
        hostKind: thread.hostKind ?? null,
        hostId: thread.hostId ?? null,
      },
      native: rest.native ?? null,
      external: rest.external ?? null,
      opener: session ?? null,
    };
  },
};
