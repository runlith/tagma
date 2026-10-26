import { Effect } from 'effect';
import { sourceSpelling } from '../contract/wire/sources.js';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { block, source } from '../store/tables.js';
import { sourceName, sourcePath } from './readers/place.js';
import { likeLiteral } from '../acts/rows.js';
import { blockName } from '../contract/wire/references.js';
import { GateRefusal, type FloorRefusal } from '../../platform/contract/wire/refusal.js';
import type { SourceRelocation } from '../contract/service/sources.js';
import { type SourceParts, sourceIdentity } from './reads.js';
import { assertDeclared } from './declared.js';
import { writes } from '../../platform/contract/service/writes.js';
import { projecting } from '../store/actWrites.js';

const relocating = writes('Sources.relocate', [source], projecting);

export const sourceRelocation = (parts: SourceParts) => {
  const { db, act, blockProjection } = parts;

  const relocationPath = (path: string): Effect.Effect<string, GateRefusal<'source-outside'>> => {
    const found = sourcePath(path);
    if (found === null || found === '.') {
      return new GateRefusal('source-outside', `"${path}" is not a place inside the project`, [
        'name a path relative to the project root, without a leading "/" or ".."',
      ]);
    }
    return Effect.succeed(found);
  };

  const relocate = Effect.fn('Sources.relocate')(function* (input: {
    projectId: number;
    from: string;
    to: string;
  }): Effect.fn.Return<
    SourceRelocation[],
    | StoreFailure
    | GateRefusal<
        | FloorRefusal
        | 'relocation-shape'
        | 'relocation-noop'
        | 'symbol-missing'
        | 'source-outside'
        | 'no-source'
        | 'duplicate-source'
        | 'not-found'
        | 'unknown-project'
      >
  > {
    const from = sourceSpelling(input.from);
    const to = sourceSpelling(input.to);
    if ((from.symbol === undefined) !== (to.symbol === undefined)) {
      return yield* new GateRefusal('relocation-shape', 'a move names two places of the same shape', [
        'reanchor_path from the old place to the new — a file or a directory, with everything under it',
        'reanchor_path naming a symbol on both sides — one symbol, renamed or moved to another file',
      ]);
    }
    const fromPath = yield* relocationPath(from.ref);
    const toPath = yield* relocationPath(to.ref);
    if (fromPath === toPath && from.symbol === to.symbol) {
      return yield* new GateRefusal('relocation-noop', 'the old place and the new one are the same', [
        'name where the code went: the source already reads there',
      ]);
    }
    const rows = yield* db
      .select({ source, block })
      .from(source)
      .innerJoin(block, eq(block.id, source.blockId))
      .where(
        and(
          eq(block.projectId, input.projectId),
          isNull(block.deletedAt),
          ...(from.symbol === undefined
            ? [or(eq(source.ref, fromPath), sql`${source.ref} like ${`${likeLiteral(fromPath)}/%`} escape '\\'`)]
            : [eq(source.kind, 'symbol'), eq(source.ref, fromPath), eq(source.symbol, from.symbol)]),
        ),
      );
    if (rows.length === 0) {
      return yield* new GateRefusal('no-source', `no source of this project reads "${input.from}"`, [
        `read_gauges ${from.ref} — every source on that place`,
      ]);
    }
    if (to.symbol !== undefined) yield* assertDeclared(parts.projects, input.projectId, toPath, to.symbol);
    return yield* act.unit(
      relocating,
      Effect.gen(function* () {
        const moved: SourceRelocation[] = [];
        for (const { source: row, block: owner } of rows) {
          const ref = from.symbol === undefined ? `${toPath}${row.ref.slice(fromPath.length)}` : toPath;
          const symbol = from.symbol === undefined ? row.symbol : (to.symbol ?? null);
          const taken = yield* db
            .select({ id: source.id })
            .from(source)
            .where(and(...sourceIdentity(owner.id, row.kind, ref, symbol), ne(source.id, row.id)));
          if (taken.length > 0) {
            return yield* new GateRefusal(
              'duplicate-source',
              `${blockName(owner.uuid)} already carries a ${row.kind} source on "${sourceName(ref, symbol)}"`,
              [`unanchor_block on ${blockName(owner.uuid)} for the ${row.kind} source ${sourceName(ref, symbol)} — then move the rest`],
            );
          }
          yield* db.update(source).set({ ref, symbol }).where(eq(source.id, row.id));
          yield* blockProjection.syncSearch(owner.id);
          yield* act.record('relocate', owner.id, {
            from: sourceName(row.ref, row.symbol),
            to: sourceName(ref, symbol),
          });
          moved.push({ blockId: owner.id, from: sourceName(row.ref, row.symbol), to: sourceName(ref, symbol) });
        }
        return moved;
      }),
    );
  });

  return { relocate };
};
