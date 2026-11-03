import { Context, Effect, Layer } from 'effect';
import { and, inArray } from 'drizzle-orm';
import { blockLine } from '../voice/lines.js';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { NATIVE_HARNESS, SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { journalSessions } from '../journal/writers.js';
import { blockName } from '../contract/wire/references.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { edge, source } from '../store/tables.js';
import { FILE_KINDS } from '../contract/wire/sources.js';
import { sourcePath } from '../sources/readers/place.js';
import { blocksOf } from '../journal/eventLog.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Selection } from '../contract/service/reads.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Orientation } from '../contract/service/orientation.js';
import { GraphJournal } from '../contract/service/journal.js';

import { Digest, SessionNames, type DigestReader, type GraphDigest } from '../contract/service/orientation.js';

type Reach = { readonly mine: ReadonlySet<number>; readonly near: ReadonlySet<number> };

type Writer = number | null;

type Seen = { readonly by: Map<Writer, string[]> };

type Label = (writer: Writer) => string;

const NAMED_WRITERS = 4;

export const digestLayer: Layer.Layer<
  Digest,
  never,
  Projects | Selection | GraphJournal | Orientation | Tags | WriterRegister | SessionNames | SessionIdentity | GraphStore
> = Layer.effect(
  Digest,
  Effect.gen(function* () {
    const vocabulary = yield* Tags;
    const projects = yield* Projects;
    const selection = yield* Selection;
    const journal = yield* GraphJournal;
    const orientation = yield* Orientation;
    const sessions = yield* WriterRegister;
    const names = yield* SessionNames;
    const identity = yield* SessionIdentity;
    const { db } = yield* GraphStore;

    const labelsOf = Effect.fn('Digest.labelsOf')(function* (
      projectId: number,
      writers: readonly Writer[],
    ): Effect.fn.Return<Label, StoreFailure> {
      const rows = yield* sessions.named(writers.filter((id): id is number => id !== null));
      const known = new Map((yield* journalSessions(names, projectId, rows)).map((row) => [row.id, row]));
      return (writer) => {
        if (writer === null) return 'operator';
        const row = known.get(writer);
        if (row === undefined) return 'unknown';
        if (row.harness !== NATIVE_HARNESS) return `session ${sessionName(row, identity)}`;
        return `agent ${row.name === null ? row.key : `${row.name} (${row.key})`}`;
      };
    });

    const reachOf = Effect.fn('Digest.reachOf')(function* (input: {
      projectId: number;
      own: number | null;
      scopeId?: number;
      written: readonly string[];
      candidates: readonly number[];
    }): Effect.fn.Return<Reach, StoreFailure | GateRefusal> {
      const mine = new Set<number>();
      const near = new Set<number>();
      if (input.candidates.length === 0) return { mine, near };
      if (input.own !== null) {
        for (const id of yield* journal.touchedBy(input.own, input.candidates)) mine.add(id);
        const held = (yield* selection.rows({ assigneeSessionId: input.own, sort: { by: 'created', order: 'asc' } }, input.projectId)).map(
          (row) => row.id,
        );
        for (const id of held) mine.add(id);
        if (held.length > 0) {
          for (const row of yield* db.select({ toId: edge.toId }).from(edge).where(inArray(edge.fromId, held))) {
            mine.add(row.toId);
          }
        }
      }
      if (input.scopeId !== undefined) for (const id of yield* selection.subtree(input.scopeId)) mine.add(id);
      const places = [...new Set(input.written.flatMap((path) => sourcePath(path) ?? []))];
      const size = rowsPerStatement(1) - FILE_KINDS.length;
      for (let at = 0; at < places.length; at += size) {
        for (const row of yield* db
          .selectDistinct({ blockId: source.blockId })
          .from(source)
          .where(and(inArray(source.kind, [...FILE_KINDS]), inArray(source.ref, places.slice(at, at + size))))) {
          near.add(row.blockId);
        }
      }
      return { mine, near };
    });

    return Digest.of({
      digest: Effect.fn('Digest.digest')(function* (input: {
        projectId: number;
        scopeId?: number;
        sinceEventId: number;
        reader?: DigestReader;
      }): Effect.fn.Return<GraphDigest, StoreFailure | GateRefusal> {
        const proj = yield* projects.byId(input.projectId);
        if (input.sinceEventId === 0) {
          const latest = (yield* journal.events({ projectId: proj.id, limit: 1 }))[0];
          return {
            text: yield* orientation.render({ projectId: proj.id, scopeId: input.scopeId }),
            throughEventId: latest?.id ?? 0,
          };
        }

        const events = yield* journal.events({ projectId: proj.id, sinceId: input.sinceEventId });
        const throughEventId = Math.max(input.sinceEventId, highestId(events));

        const own = input.reader === undefined ? null : yield* sessions.idOf(input.reader.session);
        const touched = new Map<number, Seen>();
        const unreadable: number[] = [];
        for (const entry of [...events].reverse()) {
          if (own !== null && entry.sessionId === own) continue;
          const concerned = blocksOf(entry);
          if (concerned.unreadable !== null) unreadable.push(entry.id);
          for (const id of concerned.ids) {
            const seen = touched.get(id) ?? { by: new Map() };
            const ops = seen.by.get(entry.sessionId) ?? [];
            if (!ops.includes(entry.op)) ops.push(entry.op);
            seen.by.set(entry.sessionId, ops);
            touched.set(id, seen);
          }
        }

        const reach =
          input.reader === undefined
            ? null
            : yield* reachOf({
                projectId: proj.id,
                own,
                scopeId: input.scopeId,
                written: input.reader.written,
                candidates: [...touched.keys()],
              });
        const tells = (blockId: number, seen: Seen): boolean =>
          reach === null || seen.by.has(null) || reach.mine.has(blockId) || reach.near.has(blockId);
        const shown = [...touched].filter(([blockId, seen]) => tells(blockId, seen));
        const aside = [...touched].filter(([blockId, seen]) => !tells(blockId, seen));

        const label = yield* labelsOf(proj.id, [...new Set([...touched.values()].flatMap((seen) => [...seen.by.keys()]))]);
        const lines = [`Graph changes since the previous turn — project "${proj.name}":`];
        if (shown.length > 0) {
          const table = yield* vocabulary.of(input.projectId);
          const byId = new Map(
            (yield* selection.records(shown.map(([blockId]) => blockId))).map((row) => [row.id, { ...row, name: blockName(row.uuid) }]),
          );
          lines.push('', 'Blocks:');
          for (const [blockId, seen] of shown) {
            const row = byId.get(blockId);
            if (!row) continue;
            const acts = [...seen.by].map(([writer, ops]) => `${ops.join(', ')} by ${label(writer)}`);
            lines.push(`- ${blockLine(table, row)} — ${acts.join('; ')}`);
          }
        }
        const elsewhere = elsewhereLine(aside, label);
        if (elsewhere !== null) lines.push('', elsewhere);
        if (unreadable.length > 0) {
          lines.push(
            '',
            `Journal events ${unreadable.join(', ')} could not be read, so the blocks they touched beyond their own may be missing above.`,
          );
        }
        return { text: lines.length === 1 ? null : lines.join('\n'), throughEventId };
      }),
    });
  }),
);

function elsewhereLine(blocks: readonly (readonly [number, Seen])[], label: Label): string | null {
  if (blocks.length === 0) return null;
  const writers = [...new Set(blocks.flatMap(([, seen]) => [...seen.by.keys()]))].map(label);
  const rest = writers.length - NAMED_WRITERS;
  const named = `${writers.slice(0, NAMED_WRITERS).join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
  return `Not listed: ${counted(blocks.length, 'block')} changed by ${named} (read_events).`;
}

const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

function highestId(rows: readonly { id: number }[]): number {
  return rows.reduce((top, row) => (row.id > top ? row.id : top), 0);
}
