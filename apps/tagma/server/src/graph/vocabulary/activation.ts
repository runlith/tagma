import { eq } from 'drizzle-orm';
import { Clock, Effect, Result } from 'effect';
import { canonicalJson } from '@runlith/utils/object';
import { GraphStore, type StoreDb, type StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { block } from '../store/tables.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { blockName } from '../contract/wire/references.js';
import { CATALOG_DECLARATION, type CatalogRelease, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import type { WriteSet } from '../../platform/contract/service/writes.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { Act, BlockProjection, BlockReferences, type BlockRow } from '../contract/service/acts.js';
import { Behaviours, type BehaviourRegistry } from '../contract/service/behaviours.js';
import { ActState } from '../contract/service/transaction.js';
import { Tags } from '../contract/service/vocabulary.js';
import { BlockRows } from '../acts/rows.js';
import {
  baseMissing,
  type CatalogCandidate,
  type CandidateRefusal,
  carryMissing,
  installedRevision,
  librariesFor,
  prepareCandidate,
  releaseCurrent,
  releasesCurrent,
  shippedIdentityMissing,
  type TypeWrite,
} from './candidate.js';
import { carrierReader, type ReadCarriers } from './carriers.js';
import { compose } from './compiler.js';
import { installedOf, vocabularyRows, withoutWhy } from './installed.js';

const CONTAINER_TITLE = 'Tags';
const CONTAINER_BODY =
  "This project owns its catalog workflows and tag declarations. Catalogs explain how their concepts work together; each tag defines one concept, its fields, roles, constraints and writing guidance. Read or edit these declarations here to change this project's vocabulary.";

const ATTEMPTS = 3;

export type InstallRefusal = CandidateRefusal | 'candidate-stale' | 'carriers-invalid' | 'no-root';

export type InstallRoad = {
  readonly db: StoreDb<'graph'>;
  readonly act: Act['Service'];
  readonly rows: BlockRows['Service'];
  readonly projection: BlockProjection['Service'];
  readonly references: BlockReferences['Service'];
  readonly tags: Tags['Service'];
  readonly shipped: Catalogs['Service'];
  readonly behaviours: BehaviourRegistry;
  readonly carriers: ReadCarriers;
};

export const installRoad = Effect.gen(function* () {
  return {
    db: (yield* GraphStore).db,
    act: yield* Act,
    rows: yield* BlockRows,
    projection: yield* BlockProjection,
    references: yield* BlockReferences,
    tags: yield* Tags,
    shipped: yield* Catalogs,
    behaviours: yield* Behaviours,
    carriers: yield* carrierReader,
  } satisfies InstallRoad;
});

const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

const nodeFields = ({ declaration, layer, identity, fork }: TypeWrite): Record<string, unknown> => {
  const { prompt: _prompt, ...parts } = declaration;
  return {
    ...parts,
    layer: layer ?? undefined,
    identity: identity ?? undefined,
    fork: fork ?? undefined,
  };
};

const prepared = Effect.fnUntraced(function* (
  road: InstallRoad,
  projectId: number,
  catalogIds: readonly string[],
  rows: readonly BlockRow[],
) {
  const table = yield* road.tags.of(projectId);
  const candidate = prepareCandidate(table, installedOf(rows.map(withoutWhy)), road.shipped, catalogIds, road.behaviours);
  return Result.isSuccess(candidate) ? candidate.success : yield* Effect.fail(candidate.failure);
});

const current = Effect.fnUntraced(function* (
  road: InstallRoad,
  projectId: number,
  rows: readonly BlockRow[],
  catalogIds: readonly string[],
) {
  if (rows.some((row) => withoutWhy(row) !== row)) return false;
  const installed = installedOf(rows);
  if (installed.catalogs.some((catalog) => catalog.release?.blocked !== undefined)) return false;
  const table = yield* road.tags.of(projectId);
  if (!releasesCurrent(table, installed, road.shipped, catalogIds)) return false;
  return (
    !shippedIdentityMissing(table, installed) &&
    !carryMissing(table, installed, road.shipped, catalogIds) &&
    !baseMissing(table, installed, road.shipped, catalogIds, road.behaviours)
  );
});

type SaveRest = [title: string, body: string, tags: string[], fields: Record<string, unknown>, parentId: number | null];

const saver = (road: InstallRoad, projectId: number) =>
  Effect.fnUntraced(function* (at: BlockRow | undefined, ...[title, body, tags, fields, parentId]: SaveRest) {
    if (at !== undefined && at.body === body && same(at.fields, fields)) return at;
    const now = new Date(yield* Clock.currentTimeMillis);
    const row =
      at === undefined
        ? yield* road.db
            .insert(block)
            .values({
              uuid: mintBlockId(),
              projectId,
              parentId,
              ord: yield* road.rows.nextOrd(parentId),
              title,
              body,
              tags,
              fields,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get()
        : yield* road.db.update(block).set({ body, fields, updatedAt: now }).where(eq(block.id, at.id)).returning().get();
    if (row === undefined) return yield* Effect.die('catalog installation returned no node');
    yield* road.references.syncRefs(row.id, row.body);
    yield* road.projection.syncTags(row.id);
    yield* road.projection.syncSearch(row.id);
    yield* road.act.record(
      at === undefined ? 'create' : 'update',
      row.id,
      {
        catalog: true,
        wasFields: at?.fields,
        wasBody: at?.body,
      },
      now,
    );
    return row;
  });

const stale = (reason: string): GateRefusal<'candidate-stale'> =>
  new GateRefusal('candidate-stale', reason, [
    'repeat the catalog installation: it is prepared again over the vocabulary as it stands now',
  ]);

export const installCatalogs = Effect.fn('installCatalogs')(function* (
  road: InstallRoad,
  projectId: number,
  catalogIds: readonly string[],
  checked?: CatalogCandidate,
): Effect.fn.Return<CatalogCandidate | null, StoreFailure | GateRefusal<InstallRefusal>, ActState> {
  yield* ActState;
  if (road.shipped.key === null) return null;
  const save = saver(road, projectId);
  const rows = yield* vocabularyRows(road.db, projectId);
  let candidate = checked;
  if (candidate === undefined) {
    candidate = yield* prepared(road, projectId, catalogIds, rows);
  } else {
    if (installedRevision(installedOf(rows.map(withoutWhy))) !== candidate.over.installed) {
      return yield* stale('a declaration or catalog of this project moved after this catalog candidate was prepared');
    }
    if (!same((yield* road.tags.of(projectId)).revision(), candidate.over.vocabulary)) {
      return yield* stale('the vocabulary moved after this catalog candidate was prepared');
    }
  }
  const byId = new Map<number, BlockRow>();
  for (const row of rows) {
    const normal = withoutWhy(row);
    byId.set(row.id, normal === row ? row : yield* save(row, row.title, row.body, [...row.tags], { ...normal.fields }, row.parentId));
  }
  if (candidate.catalogs.length > 0) {
    const containerId =
      rows[0] === undefined
        ? (yield* save(undefined, CONTAINER_TITLE, CONTAINER_BODY, [], {}, (yield* road.rows.rootBlockOf(projectId)).id)).id
        : rows[0].parentId;
    const names = new Map<string, string>();
    for (const row of rows)
      if (row.tags.includes(TAG_DECLARATION.id) && typeof row.fields.id === 'string') names.set(row.fields.id, blockName(row.uuid));
    for (const type of candidate.types) {
      const at = type.row === null ? undefined : byId.get(type.row);
      const own = compose({ name: `#${type.key}`, declaration: type.declaration }, null, road.behaviours);
      const body =
        type.keepBody === true && at !== undefined ? at.body : Result.isSuccess(own) ? own.success.tag.prompt : type.declaration.prompt;
      const row = yield* save(at, `#${type.key}`, body, [TAG_DECLARATION.id], nodeFields(type), at?.parentId ?? containerId);
      names.set(type.key, blockName(row.uuid));
    }
    for (const write of candidate.catalogs) {
      const members = [...new Set([...write.listed, ...write.joining.flatMap((key) => names.get(key) ?? [])])];
      const at = write.row === null ? undefined : byId.get(write.row);
      yield* save(
        at,
        write.catalog,
        write.guidance,
        [CATALOG_DECLARATION.id],
        {
          id: write.catalog,
          tags: members,
          release: write.release,
          layer: write.layer ?? undefined,
          fork: write.fork ?? undefined,
        },
        at?.parentId ?? containerId,
      );
    }
  }
  yield* road.tags.forget(projectId);
  if (candidate.affected.length > 0) yield* road.carriers(yield* road.tags.of(projectId), projectId, candidate.affected, null);
  return candidate;
});

const blockedMark = (stored: CatalogRelease, refusal: GateRefusal): CatalogRelease => ({
  ...stored,
  blocked: { code: refusal.code, reason: refusal.reason },
});

export const guardedInstall = Effect.fnUntraced(function* <A, E, R>(
  road: InstallRoad,
  projectId: number,
  catalogIds: readonly string[],
  run: (candidate: CatalogCandidate | null) => Effect.Effect<A, E, R>,
) {
  for (let attempt = 1; ; attempt += 1) {
    const rows = yield* vocabularyRows(road.db, projectId);
    if (road.shipped.key === null || (yield* current(road, projectId, rows, catalogIds))) return yield* run(null);
    const candidate = yield* prepared(road, projectId, catalogIds, rows);
    const outcome = yield* Effect.result(run(candidate));
    if (Result.isSuccess(outcome)) return outcome.success;
    const failure = outcome.failure;
    const retry = failure instanceof GateRefusal && failure.code === 'candidate-stale';
    if (!retry || attempt === ATTEMPTS) return yield* Effect.fail(failure);
  }
});

export const automaticInstall = Effect.fnUntraced(function* (
  road: InstallRoad,
  projectId: number,
  catalogIds: readonly string[],
  set: WriteSet,
) {
  const outcome = yield* Effect.result(
    guardedInstall(road, projectId, catalogIds, (candidate) =>
      candidate === null ? Effect.void : road.act.unit(set, Effect.asVoid(installCatalogs(road, projectId, catalogIds, candidate))),
    ),
  );
  if (Result.isSuccess(outcome)) return;
  const refusal = outcome.failure;
  if (!(refusal instanceof GateRefusal)) return yield* Effect.fail(refusal);
  yield* road.act.unit(
    set,
    Effect.gen(function* () {
      const rows = yield* vocabularyRows(road.db, projectId);
      if (yield* current(road, projectId, rows, catalogIds)) return;
      const installed = installedOf(rows);
      const released = installed.catalogs.flatMap((catalog) =>
        catalog.release === null ? [] : [{ ...catalog, release: catalog.release }],
      );
      if (released.length === 0) return yield* Effect.fail(refusal);
      const libraries = librariesFor(road.shipped, installed, catalogIds);
      const behind = released.filter((catalog) => !releaseCurrent(libraries.get(catalog.id), catalog.release));
      const save = saver(road, projectId);
      for (const catalog of behind.length > 0 ? behind : released) {
        const row = rows.find((one) => one.id === catalog.row);
        if (row === undefined) continue;
        const fields = { ...row.fields, release: blockedMark(catalog.release, refusal) };
        yield* save(row, row.title, row.body, [...row.tags], fields, row.parentId);
      }
    }),
  );
});
