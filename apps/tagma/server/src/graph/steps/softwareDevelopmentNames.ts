import { and, eq, like, or } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Act, BlockProjection } from '../contract/service/acts.js';
import { Tags } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { CORE_LIBRARY, type ShippedRef, shippedTypeId } from '../contract/wire/tags/identity.js';
import { block, blockTag } from '../store/tables.js';
import { projecting } from '../store/actWrites.js';
import { type Change, each, keys, object, openChildren, properties, type Raw, refFields, storedFields } from './documents.js';

const stepping = writes('Tree.step.softwareDevelopmentNames', [block, blockTag], projecting);

const WAS = 'code-project';
const NOW = 'software-development';
const NOTES = 'notes';
const NOTE = 'note';
const EXPLANATION = 'explanation';
const MOVED: ReadonlySet<string> = new Set(['reflection', 'view']);
const PREFIX = shippedTypeId(WAS, '');

const successor = (exported: string): ShippedRef =>
  MOVED.has(exported) ? { library: CORE_LIBRARY, export: exported } : { library: NOW, export: exported === NOTE ? EXPLANATION : exported };

const typeId: Change = (value) => {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const rest = value.slice(PREFIX.length);
  const at = rest.indexOf('#');
  const next = successor(at === -1 ? rest : rest.slice(0, at));
  return `${shippedTypeId(next.library, '')}${next.export}${at === -1 ? '' : rest.slice(at)}`;
};

const shipped: Change = (value) =>
  object(value) && value.library === WAS && typeof value.export === 'string' ? { ...value, ...successor(value.export) } : value;

const prose = (text: string): string =>
  text
    .replace(/\b([Aa]) #note\b/g, `$1n #${EXPLANATION}`)
    .replace(/#note\b/g, `#${EXPLANATION}`)
    .replaceAll(WAS, NOW);

const profile = properties({
  defaults: each(properties({ type: typeId })),
  batch: each(properties({ type: typeId })),
});

const declaration = (word: Change): Change =>
  properties({
    extends: word,
    fields: refFields(word),
    gates: each(openChildren(word)),
    edges: each(properties({ to: each(word) })),
    identity: properties({ shipped }),
    layer: properties({ type: word }),
    fork: shipped,
  });

const released = declaration(typeId);

const exported = (tag: unknown): unknown => {
  const out = released(tag);
  return object(out) && out.id === NOTE
    ? { ...out, id: EXPLANATION, prompt: typeof out.prompt === 'string' ? prose(out.prompt) : out.prompt }
    : out;
};

const releaseOf = (value: unknown, owned: boolean, word: Change): unknown => {
  if (!object(value)) return value;
  const { transfers: _transfers, ...kept } = value;
  return properties({
    guidance: (text) => (owned && typeof text === 'string' ? prose(text) : text),
    tags: (tags) =>
      Array.isArray(tags)
        ? owned
          ? tags.filter((tag) => !(object(tag) && typeof tag.id === 'string' && MOVED.has(tag.id))).map(exported)
          : tags.map(released)
        : tags,
    profile,
    forks: each(properties({ type: word })),
  })(kept);
};

const compact = (name: string): string => name.replaceAll('-', '').toLowerCase();

const names = (members: unknown, uuid: string): boolean =>
  Array.isArray(members) && members.some((member) => typeof member === 'string' && compact(uuid).endsWith(compact(member)));

export const softwareDevelopmentNames = Effect.fn('GraphStep.softwareDevelopmentNames')(function* (project: ProjectRow) {
  const { db } = yield* GraphStore;
  const act = yield* Act;
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
    if (row.deletedAt !== null || typeof row.fields.id !== 'string') return null;
    const type = before.identities.typeOf(row.fields.id);
    return type?.key === row.fields.id && type.id === shippedTypeId(WAS, row.fields.id) ? row.fields.id : null;
  };
  const firsts = new Map(declarations.map((row) => [row.id, firstOf(row)] as const));
  const ours = before.identities.resolveStoredType(shippedTypeId(WAS, NOTE));
  const renamed = new Map<string, string>();
  if (ours !== null) {
    renamed.set(ours, before.identities.assignKey(NOW, EXPLANATION));
    const theirs = before.identities.resolveStoredType(shippedTypeId(NOTES, NOTE));
    if (ours === NOTE && theirs !== null && theirs !== NOTE) renamed.set(theirs, NOTE);
  }
  for (const [from, to] of [...renamed]) if (from === to) renamed.delete(from);
  const word: Change = (value) => (typeof value === 'string' ? (renamed.get(value) ?? typeId(value)) : value);
  const moving = declarations.filter((row) => {
    const first = firsts.get(row.id) ?? null;
    return first !== null && MOVED.has(first);
  });
  const query = properties({ tags: each(word), selector: properties({ types: each(word) }), fields: keys((key) => typeId(key) as string) });
  const declared = declaration(word);
  const documents: Readonly<Record<string, Change>> = {
    tagExtends: word,
    tagFields: refFields(word),
    tagGates: each(openChildren(word)),
    tagEdges: each(properties({ to: each(word) })),
    tagIdentity: properties({ shipped }),
    keyedLayer: properties({ type: word }),
    typeFork: shipped,
    catalogRelease: (value) => releaseOf(value, false, word),
    catalogProfile: profile,
    blockQuery: query,
  };
  const bases = new Map<string, unknown>();
  for (const row of catalogs) {
    const release = row.fields.release;
    if (row.fields.id !== WAS || row.deletedAt !== null || !object(release) || !Array.isArray(release.tags)) continue;
    for (const tag of release.tags) if (object(tag) && typeof tag.id === 'string' && MOVED.has(tag.id)) bases.set(tag.id, tag);
  }
  yield* act.unit(
    stepping,
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      const changed = new Set<number>();
      const save = Effect.fnUntraced(function* (row: (typeof rows)[number], title: string, body: string, fields: Raw) {
        if (title === row.title && body === row.body && JSON.stringify(fields) === JSON.stringify(row.fields)) return;
        yield* db.update(block).set({ title, body, fields, updatedAt: now }).where(eq(block.id, row.id));
        changed.add(row.id);
      });
      for (const row of declarations) {
        const first = firsts.get(row.id) ?? null;
        const key = typeof row.fields.id === 'string' ? row.fields.id : null;
        const fields = declared(row.fields) as Raw;
        if (first !== null && row.fields.fork === undefined) fields.identity = { ...(fields.identity as Raw), shipped: successor(first) };
        const next = key === null || row.deletedAt !== null ? undefined : renamed.get(key);
        if (next !== undefined) fields.id = next;
        const title = next !== undefined && row.title === `#${key}` ? `#${next}` : row.title;
        yield* save(row, title, next !== undefined && key === ours ? prose(row.body) : row.body, fields);
      }
      for (const row of catalogs) {
        const owned = row.fields.id === WAS;
        const fields: Raw = { ...row.fields, release: releaseOf(row.fields.release, owned, word), profile: profile(row.fields.profile) };
        if (fields.release === undefined) delete fields.release;
        if (fields.profile === undefined) delete fields.profile;
        if (owned) fields.id = NOW;
        const members: unknown = fields.tags;
        if (Array.isArray(members) && owned) fields.tags = members.filter((member) => !moving.some((one) => names([member], one.uuid)));
        if (Array.isArray(members) && row.fields.id === CORE_LIBRARY)
          fields.tags = [
            ...members,
            ...moving.filter((one) => one.deletedAt === null && !names(members, one.uuid)).map((one) => blockName(one.uuid)),
          ];
        const release = fields.release;
        if (row.fields.id === CORE_LIBRARY && object(release) && Array.isArray(release.tags)) {
          const held: readonly unknown[] = release.tags;
          const missing = [...bases].filter(([id]) => !held.some((tag) => object(tag) && tag.id === id)).map(([, tag]) => tag);
          if (missing.length > 0) fields.release = { ...release, tags: [...held, ...missing.map(released)] };
        }
        yield* save(row, owned && row.title === WAS ? NOW : row.title, owned ? prose(row.body) : row.body, fields);
      }
      yield* projection.derive([...changed], ['tags', 'search']);
      if (changed.size > 0) yield* vocabulary.forget(project.id);
      const after = yield* vocabulary.of(project.id);
      const fieldsOf = storedFields(after, documents, (key) => typeId(key) as string);
      const spelled = [`%${WAS}%`, ...[...renamed.keys()].map((key) => `%${JSON.stringify(key)}%`)];
      const carriers = yield* db
        .select()
        .from(block)
        .where(
          and(
            eq(block.projectId, project.id),
            or(...spelled.flatMap((pattern) => [like(block.tags, pattern), like(block.fields, pattern)])),
          ),
        );
      const carried = new Set<number>();
      for (const row of carriers) {
        if (row.tags.includes(TAG_DECLARATION.id) || row.tags.includes(CATALOG_DECLARATION.id)) continue;
        const tags = row.tags.map((tag) => word(tag) as string);
        const fields = fieldsOf(after.tagsOf({ tags }), row.fields);
        if (JSON.stringify(tags) === JSON.stringify(row.tags) && JSON.stringify(fields) === JSON.stringify(row.fields)) continue;
        yield* db.update(block).set({ tags, fields, updatedAt: now }).where(eq(block.id, row.id));
        carried.add(row.id);
      }
      yield* projection.derive([...carried], ['tags']);
    }),
  );
});
