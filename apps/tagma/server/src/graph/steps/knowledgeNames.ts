import { and, eq, like, or } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Act, BlockNames, BlockProjection } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { localTypeId, shippedTypeId } from '../contract/wire/tags/identity.js';
import { projecting } from '../store/actWrites.js';
import { block, blockTag } from '../store/tables.js';
import { type Change, each, keys, object, openChildren, properties, type Raw, refFields, storedFields } from './documents.js';

const stepping = writes('Tree.step.knowledgeNames', [block, blockTag], projecting);
const WAS = 'notes';
const NOW = 'knowledge';
const LOCAL: ReadonlySet<string> = new Set(['note', 'recipe']);
const PREFIX = shippedTypeId(WAS, '');
const compact = (name: string): string => name.replaceAll('-', '').toLowerCase();

export const knowledgeNames = Effect.fn('GraphStep.knowledgeNames')(function* (project: ProjectRow) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
  const names = yield* BlockNames;
  const projection = yield* BlockProjection;
  const vocabulary = yield* Tags;
  const rows = yield* db
    .select()
    .from(block)
    .where(
      and(
        eq(block.projectId, project.id),
        or(like(block.tags, `%"${TAG_DECLARATION.id}"%`), like(block.tags, `%"${CATALOG_DECLARATION.id}"%`)),
      ),
    );
  const declarations = rows.filter((row) => row.tags.includes(TAG_DECLARATION.id));
  const catalogs = rows.filter((row) => row.tags.includes(CATALOG_DECLARATION.id));
  const before = yield* vocabulary.of(project.id);
  const firstOf = (row: (typeof rows)[number]): string | null => {
    const recorded = object(row.fields.identity) && object(row.fields.identity.shipped) ? row.fields.identity.shipped : null;
    if (recorded !== null) return recorded.library === WAS && typeof recorded.export === 'string' ? recorded.export : null;
    const type = before.identities.declaredBy(blockName(row.uuid));
    return type?.shipped?.library === WAS ? type.shipped.export : null;
  };
  const firsts = new Map(declarations.map((row) => [row.id, firstOf(row)] as const));
  const detached = new Set<number>();
  const locals = new Map<string, string | null>();
  for (const row of declarations) {
    const first = firsts.get(row.id) ?? null;
    if (first === null || !LOCAL.has(first)) continue;
    detached.add(row.id);
    const id = shippedTypeId(WAS, first);
    locals.set(id, locals.has(id) ? null : localTypeId(compact(row.uuid)));
  }
  const reference: Change = (value) => {
    if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
    const at = value.indexOf('#', PREFIX.length);
    const id = at === -1 ? value : value.slice(0, at);
    const exported = id.slice(PREFIX.length);
    const next = LOCAL.has(exported) ? (locals.get(id) ?? before.identities.resolveStoredType(id)) : `${shippedTypeId(NOW, '')}${exported}`;
    return next === null ? value : `${next}${at === -1 ? '' : value.slice(at)}`;
  };
  const shipped: Change = (value) =>
    object(value) && value.library === WAS && typeof value.export === 'string' && !LOCAL.has(value.export)
      ? { ...value, library: NOW }
      : value;
  const layer = properties({ type: (value) => (value === WAS ? NOW : reference(value)) });
  const declaration = properties({
    extends: reference,
    fields: refFields(reference),
    gates: each(openChildren(reference)),
    edges: each(properties({ to: each(reference) })),
    identity: properties({ shipped }),
    layer,
    fork: shipped,
  });
  const profile = properties({
    defaults: each(properties({ type: reference })),
    batch: each(properties({ type: reference })),
  });
  const release = properties({ tags: each(declaration), profile, forks: each(properties({ type: reference })) });
  const query = properties({
    tags: each(reference),
    selector: properties({ types: each(reference) }),
    fields: keys((key) => reference(key) as string),
  });
  const documents: Readonly<Record<string, Change>> = {
    tagExtends: reference,
    tagFields: refFields(reference),
    tagGates: each(openChildren(reference)),
    tagEdges: each(properties({ to: each(reference) })),
    tagIdentity: properties({ shipped }),
    keyedLayer: layer,
    typeFork: shipped,
    catalogRelease: release,
    catalogProfile: profile,
    blockQuery: query,
  };
  const members = yield* names.idsOfNames(
    catalogs.flatMap((row) =>
      Array.isArray(row.fields.tags) ? row.fields.tags.filter((name): name is string => typeof name === 'string') : [],
    ),
  );
  yield* act.unit(
    stepping,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const changed = new Set<number>();
      const save = Effect.fnUntraced(function* (row: (typeof rows)[number], fields: Raw, title = row.title, tags = row.tags) {
        if (
          title === row.title &&
          JSON.stringify(fields) === JSON.stringify(row.fields) &&
          JSON.stringify(tags) === JSON.stringify(row.tags)
        )
          return;
        yield* db.update(block).set({ fields, title, tags, updatedAt: now }).where(eq(block.id, row.id));
        changed.add(row.id);
      });
      for (const row of declarations) {
        const fields = declaration(row.fields) as Raw;
        const first = firsts.get(row.id) ?? null;
        if (detached.has(row.id)) {
          if (object(fields.identity)) {
            const { shipped: _shipped, ...identity } = fields.identity;
            if (Object.keys(identity).length === 0) delete fields.identity;
            else fields.identity = identity;
          }
          delete fields.layer;
          delete fields.fork;
        } else if (first !== null && row.fields.fork === undefined) {
          fields.identity = { ...(object(fields.identity) ? fields.identity : {}), shipped: { library: NOW, export: first } };
        }
        yield* save(row, fields);
      }
      for (const row of catalogs) {
        const owned = row.fields.id === WAS && object(row.fields.release);
        const fields = properties({ release, profile, layer })(row.fields) as Raw;
        if (owned) {
          fields.id = NOW;
          if (Array.isArray(fields.tags))
            fields.tags = fields.tags.filter((name) => typeof name !== 'string' || !detached.has(members.get(compact(name)) ?? -1));
          if (object(fields.release) && Array.isArray(fields.release.tags))
            fields.release = {
              ...fields.release,
              tags: fields.release.tags.filter((tag) => !object(tag) || typeof tag.id !== 'string' || !LOCAL.has(tag.id)),
            };
        }
        yield* save(row, fields, owned && row.title === WAS ? NOW : row.title);
      }
      yield* projection.derive([...changed], ['tags', 'search']);
      if (changed.size > 0) yield* vocabulary.forget(project.id);
      const after = yield* vocabulary.of(project.id);
      const fieldsOf = yield* storedFields(after, documents, properties({ tags: each(reference) }), (key) => reference(key) as string);
      const carriers = yield* db
        .select()
        .from(block)
        .where(and(eq(block.projectId, project.id), or(like(block.tags, `%${PREFIX}%`), like(block.fields, `%${WAS}%`))));
      const carried = new Set<number>();
      for (const row of carriers) {
        const tags = row.tags.map((tag) => reference(tag) as string);
        const fields = yield* fieldsOf(after.tagsOf({ tags }), row.fields);
        if (JSON.stringify(fields) === JSON.stringify(row.fields) && JSON.stringify(tags) === JSON.stringify(row.tags)) continue;
        yield* save(row, fields, row.title, tags);
        carried.add(row.id);
      }
      yield* projection.derive([...carried], ['tags']);
    }),
  );
});
