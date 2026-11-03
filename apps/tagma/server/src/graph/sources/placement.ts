import { Clock, Effect, Layer } from 'effect';
import { isTerritoryKind, type SourceInput, type SourceKind, sourceName, sourceSpelling, SOURCE_KINDS } from '../contract/wire/sources.js';
import { assertNoBoundary } from '../blocks/guards.js';
import { and, eq, inArray } from 'drizzle-orm';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { source } from '../store/tables.js';
import { type SourceTarget, assertRequiredSources, sourceKinds, sourcePath } from './readers/place.js';
import { BlockRows } from '../acts/rows.js';
import { Act, BlockNames, BlockProjection } from '../contract/service/acts.js';
import type { SourceRow, BlockRow } from '../contract/service/acts.js';
import { ActState } from '../contract/service/transaction.js';
import { blockName } from '../contract/wire/references.js';
import { GateRefusal, type FloorRefusal } from '../../platform/contract/wire/refusal.js';
import { tagLabel } from '../contract/wire/tags/roles.js';
import { Tags } from '../contract/service/vocabulary.js';
import { GraphScopes } from '../contract/service/serving.js';
import { assertDeclared } from './declared.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Sources, type PlacementRefusal } from '../contract/service/sources.js';
import { type SourceParts, sourceIdentity, sourceReads } from './reads.js';
import { writes } from '../../platform/contract/service/writes.js';
import { placing } from '../store/actWrites.js';
import { sourceOwnership } from './ownership.js';
import { sourceRelocation } from './relocation.js';

const attaching = writes('Sources.attach', [], placing);
const unanchoring = writes('Sources.unanchor', [], placing);

export const sourcesLayer: Layer.Layer<
  Sources,
  never,
  GraphStore | Act | BlockRows | BlockNames | BlockProjection | Projects | Tags | GraphScopes
> = Layer.effect(
  Sources,
  Effect.gen(function* () {
    const { db } = yield* GraphStore;
    const act = yield* Act;
    const blockRows = yield* BlockRows;
    const blockNames = yield* BlockNames;
    const blockProjection = yield* BlockProjection;
    const projects = yield* Projects;
    const scopes = yield* GraphScopes;
    const vocabulary = yield* Tags;
    const tableOf = (row: { projectId: number }) => vocabulary.of(row.projectId);

    const parts: SourceParts = { db, act, blockRows, blockNames, blockProjection, projects, scopes, vocabulary, tableOf };
    const { byBlock, of } = sourceReads(parts);
    const { atPlacePage, ownersOf, containersOf } = sourceOwnership(parts);
    const { relocate } = sourceRelocation(parts);

    const assertSourceKind = (kind: string): Effect.Effect<void, GateRefusal<'illegal-kind'>> =>
      (SOURCE_KINDS as readonly string[]).includes(kind)
        ? Effect.void
        : new GateRefusal('illegal-kind', `"${kind}" is not a source kind`, [`source kinds: ${SOURCE_KINDS.join(', ')}`]);

    const sourceTarget = (input: SourceInput): Effect.Effect<SourceTarget, GateRefusal<'source-outside' | 'symbol-shape'>> => {
      const spelled = input.kind === 'symbol' ? sourceSpelling(input.ref) : { ref: input.ref };
      if ('symbol' in spelled && spelled.symbol !== input.symbol) {
        return new GateRefusal(
          'symbol-shape',
          `"${input.ref}" names "${spelled.symbol}", but the symbol field names "${input.symbol ?? ''}"`,
          ['name the same symbol in both spellings, or pass the file path as ref and the symbol separately'],
        );
      }
      const ref = sourcePath(spelled.ref);
      if (ref === null) {
        return new GateRefusal('source-outside', `"${input.ref}" leaves the project root`, [
          'name a path relative to the project root, without a leading "/" or ".."',
        ]);
      }
      return Effect.succeed({ kind: input.kind, ref, symbol: input.symbol ?? null });
    };

    const detachSource = Effect.fn('Sources.detachSource')(function* (
      blockId: number,
      target: SourceTarget,
    ): Effect.fn.Return<boolean, StoreFailure | GateRefusal<'not-found' | 'deleted' | 'source-required'>, ActState> {
      const doomed = (yield* db
        .select({ id: source.id })
        .from(source)
        .where(and(...sourceIdentity(blockId, target.kind, target.ref, target.symbol)))).map((row) => row.id);
      if (doomed.length === 0) return false;
      const owner = yield* blockRows.blockById(blockId);
      const staying = (yield* db.select({ id: source.id, kind: source.kind }).from(source).where(eq(source.blockId, blockId))).filter(
        (row) => !doomed.includes(row.id),
      );
      yield* assertRequiredSources(
        (yield* tableOf(owner)).tagsOf(owner),
        staying,
        `anchor_block the place it stands over first, then take this one off — what a node of this tag is about is the place it names`,
      );
      yield* db.delete(source).where(inArray(source.id, doomed));
      yield* blockProjection.syncSearch(blockId);
      yield* act.record('unanchor', blockId, { path: target.ref, symbol: target.symbol });
      return true;
    });

    const place: Sources['Service']['place'] = Effect.fn('Sources.place')(function* (
      owner: BlockRow,
      input: SourceInput,
    ): Effect.fn.Return<SourceRow, StoreFailure | GateRefusal<PlacementRefusal>, ActState> {
      yield* ActState;
      const graph = yield* projects.byId(owner.projectId);
      if (graph.kind === 'group') {
        return yield* new GateRefusal(
          'group-source',
          `${blockName(owner.uuid)} stands in the graph of the group "${graph.name}", whose blocks name no code: a path's owner stays in the member whose checkout holds it`,
          [
            'link this block to the member block that owns the code — an edge crosses projects',
            'anchor the source on a block in the graph of the member whose checkout holds the path',
          ],
        );
      }
      const table = yield* tableOf(owner);
      const declared = sourceKinds(table, owner);
      if (!declared.includes(input.kind)) {
        return yield* new GateRefusal(
          'not-measurable',
          declared.length === 0
            ? `${blockName(owner.uuid)} is ${tagLabel(table.tagOf(owner))}, which declares no source`
            : `${blockName(owner.uuid)} is ${tagLabel(table.tagOf(owner))}, which stands over ${declared.join(', ')} — not a "${input.kind}"`,
          declared.length === 0
            ? [
                'a tagged node takes the source kinds its tags declare — read_tags lists them',
                'create an untagged note for a source used as navigation without delivery',
              ]
            : [`anchor it over ${declared.length === 1 ? `a "${declared[0]}"` : `one of ${declared.join(', ')}`}`],
        );
      }
      const hasSymbol = input.symbol !== undefined && input.symbol.length > 0;
      if ((input.kind === 'symbol') !== hasSymbol) {
        return yield* new GateRefusal(
          'symbol-shape',
          `a "symbol" source names its symbol and no other kind carries one; got "${input.kind}" ${hasSymbol ? `with "${input.symbol}"` : 'with none'}`,
          [
            'spell the source as kind "symbol" with the symbol set — `path#Symbol` in one spelling',
            'or as a file or a dir, with no symbol',
          ],
        );
      }
      const target = yield* sourceTarget(input);
      const existing = yield* db
        .select({ id: source.id })
        .from(source)
        .where(and(...sourceIdentity(owner.id, target.kind, target.ref, target.symbol)));
      if (existing.length > 0) {
        return yield* new GateRefusal(
          'duplicate-source',
          `${blockName(owner.uuid)} already carries a ${target.kind} source on "${sourceName(target.ref, target.symbol)}"`,
          [
            `unanchor_block on ${blockName(owner.uuid)} for the ${target.kind} source ${sourceName(target.ref, target.symbol)} — take it off first`,
          ],
        );
      }
      if (target.symbol !== null) yield* assertDeclared(projects, owner.projectId, target.ref, target.symbol);
      const row = yield* db
        .insert(source)
        .values({
          blockId: owner.id,
          kind: target.kind,
          ref: target.ref,
          symbol: target.symbol,
          createdAt: new Date(yield* Clock.currentTimeMillis),
        })
        .returning()
        .get();
      if (!row) return yield* Effect.die('source insert returned no row');
      yield* blockProjection.syncSearch(owner.id);
      yield* act.record('anchor', owner, { path: target.ref, kind: target.kind });
      return row;
    });

    return Sources.of({
      of,
      byBlock,
      place,

      attach: Effect.fn('Sources.attach')(function* (input: {
        blockId: number;
        kind: SourceKind;
        ref: string;
        symbol?: string;
        fromId?: number;
      }): Effect.fn.Return<
        SourceRow,
        StoreFailure | GateRefusal<PlacementRefusal | 'illegal-kind' | 'self-transfer' | 'no-source' | 'source-required' | 'deleted'>
      > {
        yield* assertSourceKind(input.kind);
        const owner = yield* blockRows.blockById(input.blockId);
        if (input.fromId === owner.id) {
          return yield* new GateRefusal('self-transfer', `${blockName(owner.uuid)} would take the source off itself`, [
            `anchor_block on ${blockName(owner.uuid)} for ${sourceName(input.ref, input.symbol ?? null)} — attaching needs no donor`,
            `unanchor_block on ${blockName(owner.uuid)} for ${sourceName(input.ref, input.symbol ?? null)} — taking it off is its own verb`,
          ]);
        }
        const donor = input.fromId === undefined ? undefined : yield* blockRows.blockById(input.fromId);
        if (isTerritoryKind(input.kind))
          yield* assertNoBoundary(yield* tableOf(owner), donor === undefined ? [owner] : [owner, donor], 'anchored');
        return yield* act.unit(
          attaching,
          Effect.gen(function* () {
            if (donor !== undefined) {
              const target = yield* sourceTarget(input);
              const name = sourceName(target.ref, target.symbol);
              if (!(yield* detachSource(donor.id, target))) {
                return yield* new GateRefusal('no-source', `${blockName(donor.uuid)} carries no ${target.kind} source on "${name}"`, [
                  `read_block on ${blockName(donor.uuid)} — the sources it does carry`,
                  `anchor_block on ${blockName(owner.uuid)} for the ${target.kind} source ${name} — attach it without a transfer`,
                ]);
              }
            }
            const row = yield* place(owner, input);
            return row;
          }),
        );
      }),

      unanchor: Effect.fn('Sources.unanchor')(function* (input: {
        blockId: number;
        kind: SourceKind;
        ref: string;
        symbol?: string;
      }): Effect.fn.Return<
        void,
        | StoreFailure
        | GateRefusal<
            | FloorRefusal
            | 'illegal-kind'
            | 'source-outside'
            | 'symbol-shape'
            | 'no-source'
            | 'source-required'
            | 'not-found'
            | 'deleted'
            | 'operation-only'
          >
      > {
        yield* assertSourceKind(input.kind);
        const owner = yield* blockRows.blockById(input.blockId);
        if (isTerritoryKind(input.kind)) yield* assertNoBoundary(yield* tableOf(owner), [owner], 'unanchored');
        const target = yield* sourceTarget(input);
        yield* act.unit(
          unanchoring,
          Effect.gen(function* () {
            if (!(yield* detachSource(input.blockId, target))) {
              const name = yield* blockNames.nameOf(input.blockId);
              return yield* new GateRefusal(
                'no-source',
                `${name} has no ${input.kind} source on "${sourceName(target.ref, target.symbol)}"`,
                [`read_block on ${name} — the sources it does carry`],
              );
            }
          }),
        );
      }),

      relocate,
      atPlacePage,
      ownersOf,
      containersOf,
    });
  }),
);
