import { Effect, Layer, Result } from 'effect';
import { GRAPH_EVENT_OPS, type GraphEventOp } from '../contract/wire/journal.js';
import { type JournalPayloadUnreadable, journalUnreadable, readJournal } from '../contract/wire/journalPayloads.js';
import { type BlockChange, type BlockDiff, type BlockMark, type MarkKind } from '../contract/wire/reads.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { mergedMarkdown, revertBodyDelta } from './bodyDiff.js';
import type { BlockRecord } from '../contract/service/acts.js';
import { blocksOf } from '../journal/eventLog.js';
import { type ActEntry } from '../contract/service/acts.js';
import { GraphJournal } from '../contract/service/journal.js';
import { type HistoryRefusal, History, Selection } from '../contract/service/reads.js';
import { blockName } from '../contract/wire/references.js';

const ROLE_VERBS: readonly GraphEventOp[] = ['claim', 'release', 'done', 'close', 'accept', 'reject', 'uphold'];

const decoded = <A>(read: Result.Result<A, JournalPayloadUnreadable>) => Effect.mapError(Effect.fromResult(read), journalUnreadable);

const MARK_RANK: Record<MarkKind, number> = { added: 0, deleted: 1, restored: 2, moved: 3, edited: 4 };

export const historyLayer: Layer.Layer<History, never, Selection | GraphJournal> = Layer.effect(
  History,
  Effect.gen(function* () {
    const selection = yield* Selection;
    const journal = yield* GraphJournal;

    const bodiesFrom = Effect.fn('History.bodiesFrom')(function* (
      row: { readonly body: string },
      newer: readonly ActEntry[],
      to: number,
    ): Effect.fn.Return<{ before: string | null; after: string | null }, HistoryRefusal> {
      let body: string | null = row.body;
      let after: string | null | undefined;
      for (const entry of newer) {
        if (after === undefined && entry.id <= to) after = body;
        if (body === null) continue;
        if (entry.op === 'create') {
          body = null;
          continue;
        }
        if (entry.op !== 'update') continue;
        const payload = yield* decoded(readJournal.update(entry));
        if (payload.delta !== undefined) body = revertBodyDelta(body, payload.delta);
        else if (payload.chars !== undefined) body = null;
      }
      return { before: body, after: after === undefined ? body : after };
    });

    const bodyAt = Effect.fn('History.bodyAt')(function* (
      blockId: number,
      watermark: number,
    ): Effect.fn.Return<string | null, StoreFailure | HistoryRefusal> {
      const [row] = yield* selection.records([blockId]);
      if (!row) return null;
      const newer = yield* journal.events({ blockId, sinceId: watermark });
      return (yield* bodiesFrom(row, newer, watermark)).after;
    });

    return History.of({
      bodyAt,

      positionAt: Effect.fn('History.positionAt')(function* (blockId: number, seen: Date): Effect.fn.Return<number, StoreFailure> {
        const [entry] = yield* journal.events({ blockId, until: seen, limit: 1 });
        return entry?.id ?? 0;
      }),

      blockDiff: Effect.fn('History.blockDiff')(function* (input: {
        blockId: number;
        from: number;
        to: number;
      }): Effect.fn.Return<BlockDiff, StoreFailure | HistoryRefusal> {
        const [self] = yield* selection.records([input.blockId]);
        if (self === undefined) {
          return yield* new GateRefusal('not-found', `block ${input.blockId} does not exist`, [
            'a diff is read of a block that exists, trashed or live',
          ]);
        }
        const newer = yield* journal.events({ blockId: input.blockId, sinceId: input.from });
        const entries = newer.filter((entry) => entry.id <= input.to).reverse();
        const born = entries.some((entry) => entry.op === 'create');

        let bodyTouched = born;
        let titleFrom: string | null = null;
        let titleTo: string | null = null;
        let tagFrom: string | null = null;
        let tagTo: string | null = null;
        let statusFrom: string | null = null;
        let statusTo: string | null = null;
        let statusSeen = false;
        let moved = false;
        let restated = false;
        let sizeFrom: number | null = null;
        let sizeTo: number | null = null;
        const changes: RawChange[] = [];
        for (const entry of entries) {
          if (ROLE_VERBS.includes(entry.op)) {
            const move = yield* decoded(readJournal.ending(entry));
            if (move.to !== undefined) {
              if (!statusSeen) statusFrom = move.from ?? null;
              statusSeen = true;
              statusTo = move.to;
            }
          }
          changes.push(...(yield* decoded(changeOf(entry))));
          if (entry.op !== 'update') continue;
          const payload = yield* decoded(readJournal.update(entry));
          if (payload.chars !== undefined) {
            bodyTouched = true;
            sizeFrom = sizeFrom ?? payload.wasChars ?? 0;
            sizeTo = payload.chars;
          }
          if (payload.structural === true) moved = true;
          if (payload.tags !== undefined && payload.wasTags !== undefined) {
            if (tagFrom === null) tagFrom = typeWords(payload.wasTags);
            tagTo = typeWords(payload.tags);
          }
          if (payload.wasFields !== undefined) restated = true;
          if (payload.wasTitle !== undefined && payload.title !== undefined) {
            if (titleFrom === null) titleFrom = payload.wasTitle;
            titleTo = payload.title;
          }
          if (payload.status !== undefined) {
            if (!statusSeen) statusFrom = payload.wasStatus ?? null;
            statusSeen = true;
            statusTo = payload.status;
          }
        }

        let body: string | null = null;
        let bodyUnknown = false;
        if (bodyTouched) {
          const bodies = yield* bodiesFrom(self, newer, input.to);
          const before = born ? '' : bodies.before;
          if (before === null || bodies.after === null) bodyUnknown = true;
          else if (before !== bodies.after) body = mergedMarkdown(before, bodies.after);
        }

        const raw = [
          ...(moved ? [{ kind: 'move' as const, label: 'Moved in the tree', peerId: null }] : []),
          ...(restated ? [{ kind: 'fields' as const, label: 'The values it carries were corrected', peerId: null }] : []),
          ...changes,
        ];
        const peerIds = [...new Set(raw.flatMap((change) => (change.peerId === null ? [] : [change.peerId])))];
        const peerNames = new Map((yield* selection.records(peerIds)).map((row) => [row.id, blockName(row.uuid)] as const));

        return {
          blockName: blockName(self.uuid),
          from: input.from,
          to: input.to,
          entries: entries.length,
          sessions: [...new Set(entries.map((entry) => entry.sessionId))],
          ops: [...new Set(entries.map((entry) => entry.op))],
          body,
          bodyUnknown,
          bodySize: sizeTo === null ? null : { from: sizeFrom ?? 0, to: sizeTo },
          title: titleFrom === null || titleTo === null ? null : { from: titleFrom, to: titleTo },
          status: statusTo === null ? null : { from: statusFrom, to: statusTo },
          tag: tagFrom !== null && tagTo !== null ? { from: tagFrom, to: tagTo } : yield* settledPair(entries),
          changes: raw.map(({ kind, label, peerId }) => ({
            kind,
            label,
            peerName: peerId === null ? null : (peerNames.get(peerId) ?? null),
          })),
        };
      }),

      marks: Effect.fn('History.marks')(function* (input: {
        projectId: number;
        scopeId?: number;
        from: number;
        to: number;
      }): Effect.fn.Return<{ marks: BlockMark[]; blocks: BlockRecord[] }, StoreFailure | HistoryRefusal> {
        const entries = yield* journal.events({
          projectId: input.projectId,
          sinceId: input.from,
          beforeId: input.to + 1,
          concerning: input.scopeId,
        });
        const touched = new Map<number, { ops: Set<GraphEventOp>; sessions: Set<number | null>; entries: number; moved: boolean }>();
        for (const entry of entries) {
          const moved = entry.op === 'update' && (yield* decoded(readJournal.update(entry))).structural === true;
          const concerned = blocksOf(entry);
          if (concerned.unreadable !== null) return yield* journalUnreadable(concerned.unreadable);
          for (const id of concerned.ids) {
            const seen = touched.get(id) ?? {
              ops: new Set<GraphEventOp>(),
              sessions: new Set<number | null>(),
              entries: 0,
              moved: false,
            };
            seen.ops.add(entry.op);
            seen.sessions.add(entry.sessionId);
            seen.entries += 1;
            if (moved && entry.blockId === id) seen.moved = true;
            touched.set(id, seen);
          }
        }
        if (touched.size === 0) return { marks: [], blocks: [] };

        const rows = new Map((yield* selection.records([...touched.keys()])).map((row) => [row.id, row]));
        const subtree = input.scopeId === undefined ? undefined : yield* selection.subtree(input.scopeId);
        const marks: BlockMark[] = [];
        const blocks: BlockRecord[] = [];
        for (const [blockId, seen] of touched) {
          const row = rows.get(blockId);
          if (!row || row.projectId !== input.projectId) continue;
          if (subtree !== undefined && !subtree.has(blockId) && !(row.parentId !== null && subtree.has(row.parentId))) {
            continue;
          }
          marks.push({ blockName: blockName(row.uuid), mark: markOf(seen, row), entries: seen.entries, sessions: [...seen.sessions] });
          blocks.push(row);
        }
        marks.sort((a, b) => MARK_RANK[a.mark] - MARK_RANK[b.mark] || a.blockName.localeCompare(b.blockName));
        return { marks, blocks };
      }),
    });
  }),
);

type RawChange = { kind: BlockChange['kind']; label: string; peerId: number | null };

const typeWords = (tags: readonly string[]): string => (tags.length === 0 ? 'note' : tags.join(' #'));

const settledPair = Effect.fn('History.settledPair')(function* (
  entries: readonly ActEntry[],
): Effect.fn.Return<{ from: string; to: string } | null, HistoryRefusal> {
  for (const entry of entries) {
    if (entry.op !== 'settle') continue;
    const payload = yield* decoded(readJournal.settle(entry));
    if (payload.wasTag !== undefined && payload.tag !== undefined) return { from: payload.wasTag, to: payload.tag };
  }
  return null;
});

type Changes = Result.Result<RawChange[], JournalPayloadUnreadable>;

const labelled = <A>(read: Result.Result<A, JournalPayloadUnreadable>, change: (payload: A) => RawChange): Changes =>
  Result.map(read, (payload) => [change(payload)]);

const plain = (kind: BlockChange['kind'], label: string): Changes => Result.succeed([{ kind, label, peerId: null }]);

function changeOf(entry: ActEntry): Changes {
  if (!GRAPH_EVENT_OPS.includes(entry.op)) return Result.succeed([]);
  switch (entry.op) {
    case 'anchor':
      return labelled(readJournal.anchor(entry), (p) => ({ kind: 'anchor', label: `Anchored ${p.path ?? ''}`, peerId: null }));
    case 'unanchor':
      return labelled(readJournal.unanchor(entry), (p) => ({ kind: 'unanchor', label: `Unanchored ${p.path ?? ''}`, peerId: null }));
    case 'relocate':
      return labelled(readJournal.relocate(entry), (p) => ({ kind: 'relocate', label: `Source moved to ${p.to ?? ''}`, peerId: null }));
    case 'link':
      return labelled(readJournal.link(entry), (p) => ({ kind: 'link', label: `Linked ${p.kind ?? ''}`, peerId: p.toId ?? null }));
    case 'unlink':
      return labelled(readJournal.link(entry), (p) => ({ kind: 'unlink', label: `Unlinked ${p.kind ?? ''}`, peerId: p.toId ?? null }));
    case 'supersede':
      return labelled(readJournal.supersede(entry), (p) => ({ kind: 'supersede', label: 'Replaced by a successor', peerId: p.withId }));
    case 'unsupersede':
      return labelled(readJournal.supersede(entry), (p) => ({ kind: 'unsupersede', label: 'Replacement withdrawn', peerId: p.withId }));
    case 'delete':
      return plain('delete', 'Moved to the trash');
    case 'restore':
      return plain('restore', 'Restored from the trash');
    case 'enable':
      return plain('enable', 'Rule switched on');
    case 'disable':
      return plain('disable', 'Rule switched off');
    case 'enforce':
      return labelled(readJournal.enforce(entry), (p) => ({
        kind: 'enforce',
        label: p.imported
          ? 'Enforcement imported from the graph tree'
          : p.strictness === 'off'
            ? 'Enforcement removed'
            : `Enforced at ${p.strictness ?? 'an unrecorded strictness'}`,
        peerId: null,
      }));
    case 'remeasure':
      return labelled(readJournal.remeasure(entry), (p) => ({
        kind: 'remeasure',
        label: `Re-measured: ${p.retired?.length ?? 0} debt retired, ${p.escaped?.length ?? 0} escape(s) recorded, ${p.fixed?.length ?? 0} gone`,
        peerId: null,
      }));
    case 'accept':
      return labelled(readJournal.ending(entry), (p) => ({ kind: 'accept', label: 'Proposal applied', peerId: p.amends ?? null }));
    case 'reject':
      return labelled(readJournal.ending(entry), (p) => ({ kind: 'reject', label: 'Proposal rejected', peerId: p.amends ?? null }));
    case 'uphold':
      return labelled(readJournal.ending(entry), (p) => ({ kind: 'uphold', label: 'Proposal upheld', peerId: p.amends ?? null }));
    case 'revise':
      return labelled(readJournal.revise(entry), (p) => ({
        kind: 'revise',
        label: `Payload revised: ${p.ops ?? 0} ops`,
        peerId: p.amends ?? null,
      }));
    case 'settle':
      return plain('settle', 'Settled into a doc');
    case 'answer':
      return labelled(readJournal.answer(entry), (p) =>
        p.commit !== undefined
          ? { kind: 'answer', label: `Answered by commit ${p.commit}`, peerId: null }
          : { kind: 'answer', label: 'Answered by another block', peerId: p.by ?? null },
      );
    case 'unanswer':
      return labelled(readJournal.answer(entry), (p) =>
        p.commit !== undefined
          ? { kind: 'unanswer', label: `Answer by commit ${p.commit} withdrawn`, peerId: null }
          : { kind: 'unanswer', label: 'Answer by another block withdrawn', peerId: p.by ?? null },
      );
    case 'create':
    case 'update':
    case 'claim':
    case 'release':
    case 'done':
    case 'close':
    case 'project_add':
    case 'project_set_root':
    case 'project_set':
    case 'project_set_storage':
    case 'project_remove':
    case 'project_return':
      return Result.succeed([]);
  }
}

function markOf(seen: { ops: ReadonlySet<GraphEventOp>; moved: boolean }, row: BlockRecord): MarkKind {
  if (row.deletedAt !== null && seen.ops.has('delete')) return 'deleted';
  if (seen.ops.has('create')) return 'added';
  if (seen.ops.has('restore')) return 'restored';
  if (seen.moved) return 'moved';
  return 'edited';
}
