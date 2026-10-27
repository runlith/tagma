import { Clock, Context, Effect, Predicate } from 'effect';
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
import { forkSection } from './worldState.js';

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

const TOLD = 'told';

const GRAPH = 'graph';

type GraphSpan = { readonly run: string; readonly from: number; readonly through: number };

type Heard = {
  readonly runs: ReadonlySet<string>;
  readonly sections: ReadonlyMap<string, string | null>;
  readonly graph: readonly GraphSpan[];
};

const heardIn = (history: readonly Message[]): Heard => {
  const runs = new Set<string>();
  const sections = new Map<string, string | null>();
  const graph: GraphSpan[] = [];
  for (const message of history) {
    const run = message.metadata?.[CONTEXT_RUN];
    if (typeof run !== 'string') continue;
    runs.add(run);
    const told = message.metadata?.[TOLD];
    if (Predicate.isObject(told))
      for (const [id, digest] of Object.entries(told)) if (typeof digest === 'string' || digest === null) sections.set(id, digest);
    const span = message.metadata?.[GRAPH];
    if (Predicate.isObject(span) && typeof span.from === 'number' && typeof span.through === 'number')
      graph.push({ run, from: span.from, through: span.through });
  }
  return { runs, sections, graph };
};

const resumedAt = (order: readonly string[], heard: Heard): number => {
  const kept = new Set(
    order.slice(
      0,
      Math.max(
        0,
        order.findIndex((run) => !heard.runs.has(run)),
      ),
    ),
  );
  const spans = heard.graph.filter((span) => kept.has(span.run));
  return spans.some((span) => span.from === 0) ? (spans.at(-1)?.through ?? 0) : 0;
};

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
    const heard = heardIn(deps.history);
    const lost = !compacted && !(stored.contextRuns?.every((run) => heard.runs.has(run)) ?? false);
    const prior =
      compacted || lost ? Object.fromEntries(Object.entries(stored.snapshot).filter(([id]) => heard.sections.has(id))) : stored.snapshot;
    const standing = (stored.contextRuns ?? []).filter((run) => heard.runs.has(run));

    const read = deps.digest ? yield* deps.threads.graphCursor(deps.threadId) : null;
    const cursor = read && lost ? { ...read, eventId: resumedAt(stored.contextRuns ?? [], heard) } : read;

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

    const fork = stored.fork === null ? null : { thread: stored.fork.thread, at: stored.fork.at.toISOString() };
    const world = yield* renderWorldState([forkSection(fork), ...deps.sections], prior, heard.sections);

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
          ...(world.kind === 'changed' || delivered || compacted || lost
            ? [
                deps.threads.advanceWorldState(
                  deps.threadId,
                  {
                    snapshot: { ...world.snapshot },
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
        metadata: {
          [CONTEXT_RUN]: deps.runId,
          ...(world.kind === 'changed' ? { [TOLD]: { ...world.told } } : {}),
          ...(digest !== null && digest.text !== null && cursor
            ? { [GRAPH]: { from: cursor.eventId, through: digest.throughEventId } }
            : {}),
        },
      }),
      entry,
      parts: sections,
      commit: (tx: WriteUnit<'machine'>) => advance(tx),
    };
  },
  (effect, deps) => effect.pipe(Effect.provide(deps.graph)),
);
