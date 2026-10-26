import { Clock, Effect } from 'effect';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { BlockRow } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { blockName } from '../contract/wire/references.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { shippedTypeId } from '../contract/wire/tags/identity.js';
import { SPEC } from '../contract/wire/tags/spec.js';
import { block, edge } from '../store/tables.js';
import { vocabularyRows } from '../vocabulary/installed.js';

const stepping = writes('Tree.step.decisionBecomesSpec', [block]);

const RETIRED = 'decision';
const EXPORT = 'spec';
const LIBRARY = 'code-project';
const RETIRED_ID = shippedTypeId(LIBRARY, RETIRED);
const IDS: ReadonlyMap<string, string> = new Map([
  [RETIRED_ID, shippedTypeId(LIBRARY, EXPORT)],
  ['lode/promise', SPEC],
]);

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const shippedAs = (row: BlockRow, exported: string): boolean => {
  const identity = row.fields.identity;
  return isRecord(identity) && isRecord(identity.shipped) && identity.shipped.library === LIBRARY && identity.shipped.export === exported;
};

function renames(key: string) {
  const typeWord = (value: unknown): unknown => (value === RETIRED ? key : typeof value === 'string' ? (IDS.get(value) ?? value) : value);
  const prose = (text: string): string => text.replaceAll('#decision', `#${key}`);

  const deep = (value: unknown, named?: string): unknown => {
    if (typeof value === 'string') return IDS.get(value) ?? value;
    if (Array.isArray(value)) return value.map((item) => (named === 'tags' || named === 'types' ? typeWord(item) : deep(item)));
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([name, inner]) => [IDS.get(name) ?? name, deep(inner, name)]));
  };

  const declaration = (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    const out: Raw = { ...value };
    if (out.id === RETIRED) out.id = key;
    if (out.extends !== undefined) out.extends = typeWord(out.extends);
    if (isRecord(out.roles) && Object.hasOwn(out.roles, RETIRED)) {
      const { [RETIRED]: bound, ...rest } = out.roles;
      out.roles = { ...rest, [EXPORT]: bound };
    }
    if (isRecord(out.fields)) {
      out.fields = Object.fromEntries(
        Object.entries(out.fields).map(([name, field]) => [
          name,
          isRecord(field) && field.tag !== undefined ? { ...field, tag: typeWord(field.tag) } : field,
        ]),
      );
    }
    if (Array.isArray(out.gates))
      out.gates = out.gates.map((gate) => (isRecord(gate) && gate.tag !== undefined ? { ...gate, tag: typeWord(gate.tag) } : gate));
    if (Array.isArray(out.edges))
      out.edges = out.edges.map((one) => (isRecord(one) && Array.isArray(one.to) ? { ...one, to: one.to.map(typeWord) } : one));
    if (
      isRecord(out.identity) &&
      isRecord(out.identity.shipped) &&
      out.identity.shipped.library === LIBRARY &&
      out.identity.shipped.export === RETIRED
    ) {
      out.identity = { ...out.identity, shipped: { ...out.identity.shipped, export: EXPORT } };
    }
    if (typeof out.prompt === 'string') out.prompt = prose(out.prompt);
    return out;
  };

  const releaseTag = (value: unknown): unknown => {
    const out = declaration(value);
    return isRecord(out) && out.id === key ? { ...out, id: EXPORT } : out;
  };

  const catalog = (fields: Raw): Raw => {
    const release = fields.release;
    if (!isRecord(release)) return fields;
    return {
      ...fields,
      release: {
        ...release,
        guidance: typeof release.guidance === 'string' ? prose(release.guidance) : release.guidance,
        tags: Array.isArray(release.tags) ? release.tags.map(releaseTag) : release.tags,
      },
    };
  };

  return (row: BlockRow) => {
    const declaring = row.tags.includes(TAG_DECLARATION.id);
    const listing = row.tags.includes(CATALOG_DECLARATION.id);
    const fields = declaring ? declaration(row.fields) : listing ? catalog(row.fields) : row.fields;
    return {
      title: declaring && row.title === `#${RETIRED}` ? `#${key}` : row.title,
      body: declaring || listing ? prose(row.body) : row.body,
      tags: row.tags.map((tag) => (tag === RETIRED ? key : tag)),
      fields: deep(fields) as Raw,
    };
  };
}

export const decisionBecomesSpec = Effect.fn('GraphStep.decisionBecomesSpec')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* BlockRows;
  const vocabulary = yield* vocabularyRows(db, project.id);
  const declared = (id: string) => vocabulary.find((row) => row.tags.includes(TAG_DECLARATION.id) && row.fields.id === id);
  const retired = declared(RETIRED);
  const library = vocabulary.find((row) => row.tags.includes(CATALOG_DECLARATION.id) && row.fields.id === LIBRARY);
  if (retired === undefined || library === undefined) return;
  const standing = declared(EXPORT);
  const listed = (row: BlockRow): boolean =>
    Array.isArray(library.fields.tags) && (library.fields.tags as readonly unknown[]).includes(blockName(row.uuid));
  const duplicate = standing !== undefined && (shippedAs(standing, EXPORT) || listed(standing)) ? standing : undefined;
  const key = standing === undefined || duplicate !== undefined ? EXPORT : `${encodeURIComponent(LIBRARY)}.${EXPORT}`;
  const migrated = renames(key);
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      if (duplicate !== undefined) {
        yield* db.update(block).set({ deletedAt: now }).where(eq(block.id, duplicate.id));
        const gone = blockName(duplicate.uuid);
        const kept = blockName(retired.uuid);
        for (const listing of vocabulary.filter((row) => row.tags.includes(CATALOG_DECLARATION.id) && Array.isArray(row.fields.tags))) {
          const members = listing.fields.tags as readonly unknown[];
          if (!members.includes(gone)) continue;
          const tags = [...new Set(members.map((member) => (member === gone ? kept : member)))];
          yield* db
            .update(block)
            .set({ fields: { ...listing.fields, tags }, updatedAt: now })
            .where(eq(block.id, listing.id));
        }
      }
      const filed = yield* db.all<{ id: number }>(sql`
        select d.id as id from ${block} d
        join ${block} p on p.id = d.parent_id and p.deleted_at is null
        where d.project_id = ${project.id} and d.deleted_at is null
          and d.tags like ${`%"${RETIRED}"%`} and p.tags like ${`%"${RETIRED}"%`}
          and exists (
            select 1 from ${edge} provenance
            join ${edge} built on built.from_id = provenance.to_id and built.to_id = d.id and built.kind = 'implements'
            where provenance.from_id = d.id and provenance.kind = 'discovered-from'
          )
      `);
      const fallen = new Set<number>();
      for (const { id } of filed) {
        if (fallen.has(id)) continue;
        const ids = [id, ...(yield* rows.collectDescendants(id)).map((row) => row.id)];
        yield* db.update(block).set({ deletedAt: now }).where(inArray(block.id, ids));
        for (const one of ids) fallen.add(one);
      }
      const carriers = yield* db
        .select()
        .from(block)
        .where(
          and(
            eq(block.projectId, project.id),
            or(
              like(block.tags, `%"${RETIRED}"%`),
              like(block.fields, `%${RETIRED_ID}%`),
              like(block.fields, '%tagma/promise%'),
              like(block.fields, `%"${RETIRED}"%`),
              like(block.body, '%#decision%'),
            ),
          ),
        );
      for (const row of carriers) {
        if (row.id === duplicate?.id) continue;
        const next = migrated(row);
        if (next.title === row.title && next.body === row.body && same(next.tags, row.tags) && same(next.fields, row.fields)) continue;
        yield* db
          .update(block)
          .set({ ...next, updatedAt: now })
          .where(eq(block.id, row.id));
      }
    }),
  );
});
