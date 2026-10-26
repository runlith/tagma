import { Clock, Context, Effect } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { type PackedWorldStateSection, renderWorldState } from '@runlith/agent/WorldState';
import type { ThreadContextEntry } from '@runlith/agent/transcript/entries';
import type { ThreadTurnContextIn } from '@runlith/agent/thread/agents/ThreadAgent';
import type { NativeThreadRows } from '../rows/native.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { type StoreFailure, GraphStore } from '../../platform/contract/service/store.js';
import type { SessionRef } from '../../platform/contract/wire/session.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { Digest } from '../../graph/contract/service/orientation.js';
import { block } from '../../graph/store/tables.js';
import { eq } from 'drizzle-orm';
import { inventoryChars, type StartPieces } from '../agents/start.js';

type TurnFailure = StoreFailure | GateRefusal;

const CONTEXT_RUN = 'contextRun';

const TURN_NOTES = { workspace: 'Workspace', graph: 'Graph', deferred: 'Deferred tools' } as const;

export function turnNotes(history: readonly Message[], runId: string): StartPieces['notes'] {
  const declared = history.find((message) => message.metadata?.[CONTEXT_RUN] === runId)?.metadata?.parts;
  const sized = (name: string): number | null => {
    if (!Array.isArray(declared)) return null;
    for (const part of declared as readonly unknown[]) {
      if (typeof part !== 'object' || part === null) continue;
      const { name: named, chars } = part as { name?: unknown; chars?: unknown };
      if (named === name && typeof chars === 'number') return chars;
    }
    return null;
  };
  return { workspace: sized(TURN_NOTES.workspace), graph: sized(TURN_NOTES.graph), deferred: sized(TURN_NOTES.deferred) };
}

const toldRuns = (history: readonly Message[]): ReadonlySet<string> =>
  new Set(
    history.flatMap((message) => {
      const run = message.metadata?.[CONTEXT_RUN];
      return typeof run === 'string' ? [run] : [];
    }),
  );

export const nativeTurnContext = Effect.fn('native-harness.turnContext')(
  function* (deps: {
    threads: NativeThreadRows;
    graph: Context.Context<GraphServices | GraphStore>;
    threadId: string;
    runId: string;
    history: readonly Message[];
    sections: readonly PackedWorldStateSection[];
    digest: boolean;
    session: SessionRef;
    written: Effect.Effect<readonly string[], StoreFailure>;
  }) {
    const stored = yield* deps.threads.worldStateSnapshot(deps.threadId);
    const checkpointId = yield* deps.threads.latestCompactionCheckpointId(deps.threadId);
    const compacted = stored.checkpointId !== checkpointId;
    const told = toldRuns(deps.history);
    const lost = !compacted && !(stored.contextRuns?.every((run) => told.has(run)) ?? false);
    const prior = compacted || lost ? {} : stored.snapshot;
    const standing = compacted || lost ? [] : (stored.contextRuns ?? []);

    const read = deps.digest ? yield* deps.threads.graphCursor(deps.threadId) : null;
    const cursor = read && lost ? { ...read, eventId: 0 } : read;

    const digest = cursor
      ? yield* Effect.gen(function* () {
          const digests = yield* Digest;
          const scope =
            cursor.scopeBlockUuid === null
              ? undefined
              : (yield* Effect.flatMap(GraphStore, (store) =>
                  store.db
                    .select({ id: block.id })
                    .from(block)
                    .where(eq(block.uuid, cursor.scopeBlockUuid as string))
                    .get(),
                ))?.id;
          return yield* digests.digest({
            projectId: cursor.projectId,
            scopeId: scope,
            sinceEventId: cursor.eventId,
            reader: { session: deps.session, written: yield* deps.written },
          });
        })
      : null;

    const world = yield* renderWorldState([...deps.sections], prior);

    const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const parts: string[] = [];
    const readable: string[] = [];
    const inventory = world.kind === 'changed' ? world.content.filter((part) => part.deferredTools !== undefined) : [];
    const sections: { name: string; chars: number }[] = [];
    if (world.kind === 'changed') {
      const workspace = world.content
        .filter((part) => part.deferredTools === undefined)
        .map((part) => part.text)
        .join('\n\n');
      if (workspace.length > 0) parts.push(`<workspace at="${occurredAt}">\n${workspace}\n</workspace>`);
      readable.push(`## Workspace\n\n${world.text}`);
      sections.push({ name: TURN_NOTES.workspace, chars: workspace.length });
      if (inventory.length > 0) sections.push({ name: TURN_NOTES.deferred, chars: inventoryChars(inventory) });
    }
    if (digest !== null && digest.text !== null) {
      parts.push(`<graph at="${occurredAt}">\n${digest.text}\n</graph>`);
      readable.push(`## Graph\n\n${digest.text}`);
      sections.push({ name: TURN_NOTES.graph, chars: digest.text.length });
    }

    const delivered = parts.length > 0 || inventory.length > 0;
    const advance = (tx?: Unit<'machine'>): Effect.Effect<void, StoreFailure> =>
      Effect.all(
        [
          ...(digest !== null
            ? [
                deps.threads.advanceGraphCursor(
                  deps.threadId,
                  {
                    eventId: digest.throughEventId,
                  },
                  tx,
                ),
              ]
            : []),
          ...(world.kind === 'changed' || delivered
            ? [
                deps.threads.advanceWorldState(
                  deps.threadId,
                  {
                    snapshot: world.kind === 'changed' ? { ...world.snapshot } : prior,
                    checkpointId,
                    contextRuns: delivered ? [...standing, deps.runId] : standing,
                  },
                  tx,
                ),
              ]
            : []),
        ],
        { discard: true },
      );

    if (!delivered) {
      yield* advance();
      return null;
    }

    const entry: ThreadContextEntry = {
      type: 'context',
      id: `turn-context:${deps.runId}`,
      runId: deps.runId,
      text: readable.join('\n\n'),
      occurredAt,
    };
    const context = parts.join('\n\n');
    return {
      message: Message.make({
        role: 'user',
        content: [...(context.length === 0 ? [] : [{ type: 'text' as const, text: context }]), ...inventory],
        metadata: { [CONTEXT_RUN]: deps.runId },
      }),
      entry,
      parts: sections,
      commit: (tx: WriteUnit<'machine'>) => advance(tx),
    };
  },
  (effect, deps) => effect.pipe(Effect.provide(deps.graph)),
);
