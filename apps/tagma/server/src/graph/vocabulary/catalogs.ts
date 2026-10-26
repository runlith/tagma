import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Effect, Layer, Option, Result, Schema } from 'effect';
import { type StoreDb, GraphStore } from '../../platform/contract/service/store.js';
import { block, blockTag } from '../store/tables.js';
import { blockRef } from '../contract/wire/fields.js';
import { blockName } from '../contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CATALOG_DECLARATION, catalogFieldsSchema, type InstalledCatalog, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { storedProfile } from '../contract/wire/tags/profile.js';
import { BlockNames, type BlockRow } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { InstalledCatalogs, Tags } from '../contract/service/vocabulary.js';
import { Behaviours } from '../contract/service/behaviours.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { catalogFindings } from './candidate.js';
import type { CatalogFinding } from '../contract/wire/tags/findings.js';
import { ActState } from '../contract/service/transaction.js';
import { lawRevision } from '../store/lawRevision.js';
import { installedOf, vocabularyRows, withoutWhy } from './installed.js';

export const catalogFields = (row: Pick<BlockRow, 'uuid' | 'fields'>) =>
  Schema.decodeUnknownEffect(catalogFieldsSchema)(row.fields).pipe(
    Effect.mapError(
      (error) =>
        new GateRefusal('field-invalid', `${blockName(row.uuid)}: ${error.message}`, [
          'correct the catalog id and its list of local #tag references',
        ]),
    ),
  );

export const installedCatalogs = Effect.fn('InstalledCatalogs.read')(function* (projectId: number) {
  const { db } = yield* GraphStore;
  const blockRows = yield* BlockRows;
  const blockNames = yield* BlockNames;
  const rows = yield* db
    .select({ node: block })
    .from(block)
    .innerJoin(blockTag, eq(blockTag.blockId, block.id))
    .where(and(eq(block.projectId, projectId), isNull(block.deletedAt), eq(blockTag.tag, CATALOG_DECLARATION.id)))
    .orderBy(block.ord, block.id);
  const result: InstalledCatalog[] = [];
  const catalogIds = new Set<string>();
  for (const { node } of rows) {
    const fields = yield* catalogFields(node);
    if (catalogIds.has(fields.id)) {
      return yield* new GateRefusal('field-invalid', `catalog id "${fields.id}" is declared more than once`, [
        'give each installed catalog its own id',
      ]);
    }
    catalogIds.add(fields.id);
    const named = yield* blockNames.idsOfNames(fields.tags);
    const ids = [...new Set(named.values())];
    const byId = new Map<number, Pick<BlockRow, 'id' | 'uuid' | 'projectId' | 'deletedAt' | 'tags'>>();
    const room = rowsPerStatement(1);
    for (let at = 0; at < ids.length; at += room) {
      const targets = yield* db
        .select({
          id: block.id,
          uuid: block.uuid,
          projectId: block.projectId,
          deletedAt: block.deletedAt,
          tags: block.tags,
        })
        .from(block)
        .where(inArray(block.id, ids.slice(at, at + room)));
      for (const target of targets) byId.set(target.id, target);
    }
    const tags: string[] = [];
    for (const ref of fields.tags) {
      const id = named.get(ref.toLowerCase().replaceAll('-', '')) ?? (yield* blockNames.idOfName(ref));
      const held = byId.get(id);
      const target = held !== undefined && held.deletedAt === null ? held : yield* blockRows.blockById(id);
      if (target.projectId !== projectId || target.deletedAt !== null || !target.tags.includes(TAG_DECLARATION.id)) {
        return yield* new GateRefusal('field-target', `${blockName(node.uuid)}.tags: ${ref} is not a local standing #tag declaration`, [
          'correct the catalog membership to name standing #tag nodes in this graph',
        ]);
      }
      tags.push(blockName(target.uuid));
    }
    const profile = storedProfile(node.fields);
    if (Result.isFailure(profile)) {
      return yield* new GateRefusal('field-invalid', `${blockName(node.uuid)}.profile: ${profile.failure.message}`, [
        'correct the catalog profile to the grammar the catalog wire states',
      ]);
    }
    result.push({
      name: blockName(node.uuid),
      id: fields.id,
      guidance: node.body,
      tags,
      release: fields.release,
      profile: profile.success ?? undefined,
    });
  }
  return result;
});

export const assertMembersStand = Effect.fn('InstalledCatalogs.assertMembersStand')(function* (
  db: StoreDb<'graph'>,
  projectId: number,
  falling: readonly Pick<BlockRow, 'id' | 'uuid' | 'tags'>[],
) {
  const names = new Set(falling.filter((row) => row.tags.includes(TAG_DECLARATION.id)).map((row) => blockName(row.uuid)));
  if (names.size === 0) return;
  const gone = new Set(falling.map((row) => row.id));
  const catalogs = yield* db
    .select({ id: block.id, uuid: block.uuid, fields: block.fields })
    .from(block)
    .innerJoin(blockTag, eq(blockTag.blockId, block.id))
    .where(and(eq(block.projectId, projectId), isNull(block.deletedAt), eq(blockTag.tag, CATALOG_DECLARATION.id)));
  for (const catalog of catalogs) {
    if (gone.has(catalog.id)) continue;
    const members = Array.isArray(catalog.fields.tags)
      ? catalog.fields.tags.filter((member): member is string => typeof member === 'string')
      : [];
    const named = members.find((member) => names.has(member));
    if (named === undefined) continue;
    return yield* new GateRefusal(
      'catalog-member',
      `${named} is named by the standing catalog ${blockName(catalog.uuid)}; a declaration a catalog names does not fall alone`,
      [
        `edit ${blockName(catalog.uuid)} and drop ${named} from its tags field first`,
        `or delete ${blockName(catalog.uuid)} in the same batch`,
      ],
    );
  }
});

export const assertCatalog = Effect.fn('InstalledCatalogs.assert')(function* (
  db: StoreDb<'graph'>,
  node: Pick<BlockRow, 'id' | 'uuid' | 'projectId' | 'tags' | 'fields'>,
) {
  if (!node.tags.includes(CATALOG_DECLARATION.id)) return;
  const fields = yield* catalogFields(node);
  const peers = yield* db
    .select({ id: block.id, fields: block.fields })
    .from(block)
    .innerJoin(blockTag, eq(blockTag.blockId, block.id))
    .where(and(eq(block.projectId, node.projectId), isNull(block.deletedAt), eq(blockTag.tag, CATALOG_DECLARATION.id)));
  if (peers.some((peer) => peer.id !== node.id && peer.fields.id === fields.id)) {
    return yield* new GateRefusal('field-invalid', `catalog id "${fields.id}" is already declared`, [
      'edit the existing catalog or choose a distinct id',
    ]);
  }
});

export const installedCatalogsLayer: Layer.Layer<
  InstalledCatalogs,
  never,
  GraphStore | BlockRows | BlockNames | Tags | Catalogs | Behaviours
> = Layer.effect(
  InstalledCatalogs,
  Effect.gen(function* () {
    const store = yield* GraphStore;
    const blockRows = yield* BlockRows;
    const blockNames = yield* BlockNames;
    const tags = yield* Tags;
    const shipped = yield* Catalogs;
    const behaviours = yield* Behaviours;
    const judged = new Map<number, { readonly revision: string; readonly findings: readonly CatalogFinding[] }>();
    const provided = <A, E>(effect: Effect.Effect<A, E, GraphStore | BlockRows | BlockNames>): Effect.Effect<A, E> =>
      effect.pipe(
        Effect.provideService(GraphStore, store),
        Effect.provideService(BlockRows, blockRows),
        Effect.provideService(BlockNames, blockNames),
      );
    return InstalledCatalogs.of({
      read: (projectId) => provided(installedCatalogs(projectId)),
      findings: Effect.fn('InstalledCatalogs.findings')(function* (projectId: number) {
        if (shipped.key === null) return [];
        const unit = Option.isSome(yield* Effect.serviceOption(ActState));
        const revision = yield* lawRevision(store.db, projectId);
        const held = unit ? undefined : judged.get(projectId);
        if (held?.revision === revision) return held.findings;
        const table = yield* tags.of(projectId);
        const installed = installedOf((yield* vocabularyRows(store.db, projectId)).map(withoutWhy));
        const findings = catalogFindings(table, installed, shipped, behaviours);
        if (!unit) judged.set(projectId, { revision, findings });
        return findings;
      }),
      assertMembersStand: (db, projectId, falling) => assertMembersStand(db, projectId, falling),
      assertCatalog: (db, node) => assertCatalog(db, node),
    });
  }),
);
