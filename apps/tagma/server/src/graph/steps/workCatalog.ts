import { and, eq, inArray, like, or } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { BlockRows } from '../acts/rows.js';
import { Act, BlockProjection, BlockReferences, type BlockRow } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { blockName } from '../contract/wire/references.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { CORE_LIBRARY, shippedTypeId } from '../contract/wire/tags/identity.js';
import { projecting, referencing } from '../store/actWrites.js';
import { block, blockTag } from '../store/tables.js';
import { object, type Raw } from './documents.js';

const stepping = writes('Tree.step.workCatalog', [block, blockTag], projecting, referencing);

const WAS = 'software-development';
const WORK = 'work';
const MOVED: ReadonlyMap<string, string> = new Map([
  ['rule', CORE_LIBRARY],
  ['task', WORK],
  ['spec', WORK],
  ['idea', WORK],
  ['research', WORK],
]);
const PREFIX = shippedTypeId(WAS, '');

const successor = (word: string): string | null => {
  if (!word.startsWith(PREFIX)) return null;
  const rest = word.slice(PREFIX.length);
  const at = rest.indexOf('#');
  const exported = at === -1 ? rest : rest.slice(0, at);
  const library = MOVED.get(exported);
  return library === undefined ? null : `${shippedTypeId(library, exported)}${at === -1 ? '' : rest.slice(at)}`;
};

const repointed = (value: unknown): unknown => {
  if (typeof value === 'string') return successor(value) ?? value;
  if (Array.isArray(value)) return value.map(repointed);
  if (!object(value)) return value;
  const out: Raw = {};
  for (const [key, one] of Object.entries(value)) out[successor(key) ?? key] = repointed(one);
  const library = typeof out.export === 'string' && out.library === WAS ? MOVED.get(out.export) : undefined;
  if (library !== undefined) out.library = library;
  return out;
};

const compact = (name: string): string => name.replaceAll('-', '').toLowerCase();

const names = (member: unknown, uuid: string): boolean => typeof member === 'string' && compact(uuid).endsWith(compact(member));

const idOf = (tag: unknown): string | null => (object(tag) && typeof tag.id === 'string' ? tag.id : null);

const same = (one: unknown, other: unknown): boolean => JSON.stringify(one) === JSON.stringify(other);

export const workCatalog = Effect.fn('GraphStep.workCatalog')(function* (project: ProjectRow) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const projection = yield* BlockProjection;
  const references = yield* BlockReferences;
  const blockRows = yield* BlockRows;
  const vocabulary = yield* Tags;
  const rows = yield* db
    .select()
    .from(block)
    .where(
      and(
        eq(block.projectId, project.id),
        or(like(block.fields, `%${WAS}%`), like(block.tags, `%${PREFIX}%`), like(block.tags, `%"${TAG_DECLARATION.id}"%`)),
      ),
    );
  if (!rows.some((row) => JSON.stringify(row.fields).includes(WAS) || row.tags.some((tag) => tag.startsWith(PREFIX)))) return;
  const before = yield* vocabulary.of(project.id);
  const exportOf = (row: BlockRow): string | null => {
    if (!row.tags.includes(TAG_DECLARATION.id) || row.deletedAt !== null) return null;
    const recorded = object(row.fields.identity) && object(row.fields.identity.shipped) ? row.fields.identity.shipped : null;
    if (recorded !== null) return recorded.library === WAS && typeof recorded.export === 'string' ? recorded.export : null;
    const type = before.identities.declaredBy(blockName(row.uuid));
    return type?.shipped?.library === WAS ? type.shipped.export : null;
  };
  const moving = rows.flatMap((row) => {
    const exported = exportOf(row);
    const library = exported === null ? undefined : MOVED.get(exported);
    return exported === null || library === undefined ? [] : [{ row, exported, library }];
  });
  const listing = (rowsOf: readonly BlockRow[], id: string) =>
    rowsOf.find((row) => row.tags.includes(CATALOG_DECLARATION.id) && row.deletedAt === null && row.fields.id === id);
  const was = listing(rows, WAS);
  const wasRelease = object(was?.fields.release) ? was.fields.release : null;
  const wasBases = Array.isArray(wasRelease?.tags) ? wasRelease.tags : [];
  const receivers = was === undefined ? [] : [CORE_LIBRARY, WORK];
  const standing =
    receivers.length === 0
      ? []
      : yield* db
          .select()
          .from(block)
          .where(and(eq(block.projectId, project.id), like(block.tags, `%"${CATALOG_DECLARATION.id}"%`)));

  yield* act.unit(
    stepping,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const changed = new Set<number>();
      const fieldsOf = new Map<number, Raw>(rows.map((row) => [row.id, row.fields]));
      for (const { row, exported, library } of moving) {
        if (row.fields.fork !== undefined) continue;
        const identity = object(row.fields.identity) ? row.fields.identity : {};
        fieldsOf.set(row.id, { ...row.fields, identity: { ...identity, shipped: { library, export: exported } } });
      }
      if (was !== undefined) {
        const members = Array.isArray(was.fields.tags) ? was.fields.tags : [];
        const fields: Raw = {
          ...fieldsOf.get(was.id)!,
          tags: members.filter((member) => !moving.some(({ row }) => names(member, row.uuid))),
        };
        if (wasRelease !== null) fields.release = { ...wasRelease, tags: wasBases.filter((tag) => !MOVED.has(idOf(tag) ?? '')) };
        fieldsOf.set(was.id, fields);
      }
      for (const library of receivers) {
        const joining = moving.filter((one) => one.library === library && one.row.deletedAt === null).map(({ row }) => row);
        const bases = wasBases.filter((tag) => MOVED.get(idOf(tag) ?? '') === library);
        if (joining.length === 0 && bases.length === 0) continue;
        const held = listing(standing, library);
        const fields: Raw = held === undefined ? { id: library, tags: [] } : { ...(fieldsOf.get(held.id) ?? held.fields) };
        const members: readonly unknown[] = Array.isArray(fields.tags) ? fields.tags : [];
        fields.tags = [
          ...members,
          ...joining.filter((row) => !members.some((member) => names(member, row.uuid))).map((row) => blockName(row.uuid)),
        ];
        const release = object(fields.release) ? fields.release : { revision: wasRelease?.revision ?? WAS, guidance: '', tags: [] };
        const releaseTags: readonly unknown[] = Array.isArray(release.tags) ? release.tags : [];
        fields.release = {
          ...release,
          tags: [...releaseTags, ...bases.filter((tag) => !releaseTags.some((one) => idOf(one) === idOf(tag)))],
        };
        if (held !== undefined) {
          fieldsOf.set(held.id, fields);
          if (!rows.some((row) => row.id === held.id)) rows.push(held);
          continue;
        }
        const parentId = was!.parentId;
        const born = yield* db
          .insert(block)
          .values({
            uuid: mintBlockId(),
            projectId: project.id,
            parentId,
            ord: yield* blockRows.nextOrd(parentId),
            title: library,
            body: '',
            tags: [CATALOG_DECLARATION.id],
            fields: repointed(fields) as Raw,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        if (born === undefined) return yield* Effect.die('a catalog insert returned no row');
        yield* references.syncRefs(born.id, born.body, { projectId: project.id });
        yield* projection.syncBorn(born, true);
        yield* act.record('create', born, { catalog: true }, now);
      }
      for (const row of rows) {
        const fields = repointed(fieldsOf.get(row.id) ?? row.fields) as Raw;
        const tags = row.tags.map((tag) => successor(tag) ?? tag);
        if (same(fields, row.fields) && same(tags, row.tags)) continue;
        yield* db.update(block).set({ fields, tags, updatedAt: now }).where(eq(block.id, row.id));
        changed.add(row.id);
      }
      const mine = db.select({ id: block.id }).from(block).where(eq(block.projectId, project.id));
      for (const [exported, library] of MOVED) {
        yield* db
          .update(blockTag)
          .set({ typeId: shippedTypeId(library, exported) })
          .where(and(eq(blockTag.typeId, shippedTypeId(WAS, exported)), inArray(blockTag.blockId, mine)));
      }
      yield* projection.derive([...changed], ['tags', 'search']);
      yield* vocabulary.forget(project.id);
    }),
  );
});
