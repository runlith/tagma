import { Clock, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { SignedCall, type WriterRegister } from '../../platform/contract/service/writers.js';
import type { EdgeKind } from '../contract/wire/edges.js';
import type { GraphEventOp } from '../contract/wire/journal.js';
import { block, edge, event, farEdge } from '../store/tables.js';
import { type FarTarget, farText } from '../contract/wire/far.js';
import { ActState } from '../contract/service/transaction.js';
import { transactionUnit } from './state.js';
import type { Act, RecordedBlock } from '../contract/service/acts.js';
import type { Edges } from '../contract/service/blocks.js';
import type { Tags } from '../contract/service/vocabulary.js';
import { advanceLaw, shapesLaw } from '../store/lawRevision.js';

export function verdictReason(reason: string | undefined): string | null {
  const text = reason?.trim() ?? '';
  return text.length > 0 ? text : null;
}

export function actRecords(db: GraphStore['Service']['db'], sessions: WriterRegister['Service'], tags: Tags['Service']) {
  const record: Act['Service']['record'] = Effect.fn('Act.record')(function* (
    op: GraphEventOp,
    subject: number | RecordedBlock | null,
    payload: Record<string, unknown>,
    at?: Date,
    writer?: number,
  ): Effect.fn.Return<void, StoreFailure, ActState> {
    const held = yield* ActState;
    const sessionId = writer ?? (yield* sessions.signedId(yield* transactionUnit));
    const callId = yield* SignedCall;
    const blockId = typeof subject === 'number' || subject === null ? subject : subject.id;
    const owner =
      subject === null
        ? undefined
        : typeof subject === 'number'
          ? yield* db.select({ projectId: block.projectId }).from(block).where(eq(block.id, subject)).get()
          : subject;
    const entry = yield* db
      .insert(event)
      .values({
        ts: at ?? new Date(yield* Clock.currentTimeMillis),
        sessionId,
        callId,
        op,
        blockId,
        projectId: owner?.projectId ?? null,
        payload: JSON.stringify(payload),
      })
      .returning()
      .get();
    if (entry !== undefined) held.recorded.push(entry);
    if (blockId !== null && owner !== undefined && !op.startsWith('project_')) {
      const table = yield* tags.of(owner.projectId);
      const targets = [blockId, ...(typeof payload.toId === 'number' ? [payload.toId] : [])];
      if (yield* shapesLaw(db, table, owner.projectId, targets)) yield* advanceLaw(db, owner.projectId);
    }
  });

  const insertEdgeRow: Edges['Service']['insertEdgeRow'] = Effect.fn('Act.insertEdgeRow')(function* (
    fromId: number,
    kind: EdgeKind,
    toId: number,
  ) {
    yield* ActState;
    const createdBySessionId = yield* sessions.signedId(yield* transactionUnit);
    const inserted = yield* db
      .insert(edge)
      .values({ fromId, toId, kind, createdBySessionId, createdAt: new Date(yield* Clock.currentTimeMillis) })
      .onConflictDoNothing()
      .returning();
    return inserted.length > 0;
  });

  const insertEdge = Effect.fn('Act.insertEdge')(function* (
    fromId: number,
    kind: EdgeKind,
    toId: number,
  ): Effect.fn.Return<void, StoreFailure, ActState> {
    if (!(yield* insertEdgeRow(fromId, kind, toId))) return;
    yield* record('link', fromId, { kind, toId });
  });

  const insertFarEdge: Edges['Service']['insertFarEdge'] = Effect.fn('Act.insertFarEdge')(function* (
    fromId: number,
    kind: EdgeKind,
    target: FarTarget,
  ) {
    yield* ActState;
    const createdBySessionId = yield* sessions.signedId(yield* transactionUnit);
    const inserted = yield* db
      .insert(farEdge)
      .values({
        fromId,
        kind,
        graph: target.graph,
        uuid: target.uuid,
        label: target.label,
        createdBySessionId,
        createdAt: new Date(yield* Clock.currentTimeMillis),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) return;
    yield* record('link', fromId, { kind, far: farText(target) });
  });

  return { record, insertEdgeRow, insertEdge, insertFarEdge };
}
