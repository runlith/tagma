import { Clock, Effect } from 'effect';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { blockName } from '../contract/wire/references.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { SOURCE_KINDS } from '../contract/wire/sources.js';
import { block, source } from '../store/tables.js';

const stepping = writes('Tree.step.claimsLeave', [block, source]);

const CLAIM = 'claim';

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const kinds = (value: unknown): unknown =>
  Array.isArray(value) ? value.filter((kind) => (SOURCE_KINDS as readonly unknown[]).includes(kind)) : value;

function declaration(value: Raw): Raw {
  const out: Raw = { ...value };
  if (isRecord(out.roles) && Object.hasOwn(out.roles, CLAIM)) {
    const { [CLAIM]: _claim, ...roles } = out.roles;
    out.roles = roles;
  }
  if (out.sources !== undefined) out.sources = kinds(out.sources);
  if (isRecord(out.body) && out.body.shape === CLAIM) out.body = { ...out.body, shape: 'content' };
  if (Array.isArray(out.gates)) {
    out.gates = out.gates.map((gate) => (isRecord(gate) && gate.gate === 'source-required' ? { ...gate, kinds: kinds(gate.kinds) } : gate));
  }
  return out;
}

function catalog(value: Raw, gone: ReadonlySet<string>): Raw {
  const out: Raw = { ...value };
  if (Array.isArray(out.tags)) out.tags = out.tags.filter((member) => typeof member !== 'string' || !gone.has(member));
  if (isRecord(out.release)) {
    const release: Raw = { ...out.release };
    if (Array.isArray(release.tags)) {
      release.tags = release.tags
        .filter((tag) => !isRecord(tag) || tag.id !== CLAIM)
        .map((tag) => (isRecord(tag) ? declaration(tag) : tag));
    }
    out.release = release;
  }
  return out;
}

export const claimsLeave = Effect.fn('GraphStep.claimsLeave')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db
    .select({ id: block.id, uuid: block.uuid, parentId: block.parentId, tags: block.tags, fields: block.fields })
    .from(block)
    .where(and(eq(block.projectId, project.id), isNull(block.deletedAt)));
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const doomed = new Set(
    rows
      .filter((row) => row.tags.includes(CLAIM) || (row.tags.includes(TAG_DECLARATION.id) && row.fields.id === CLAIM))
      .map((row) => row.id),
  );
  const gone = new Set(rows.flatMap((row) => (doomed.has(row.id) && row.uuid !== null ? [blockName(row.uuid)] : [])));
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const row of rows) {
        if (doomed.has(row.id)) continue;
        let parentId = row.parentId;
        while (parentId !== null && doomed.has(parentId)) parentId = byId.get(parentId)?.parentId ?? null;
        const declaring = row.tags.includes(TAG_DECLARATION.id);
        const listing = row.tags.includes(CATALOG_DECLARATION.id);
        let fields: Raw = declaring ? declaration(row.fields) : listing ? catalog(row.fields, gone) : row.fields;
        if (isRecord(fields.query) && (Object.hasOwn(fields.query, 'verified') || Object.hasOwn(fields.query, 'drifted'))) {
          const { verified: _verified, drifted: _drifted, ...query } = fields.query;
          fields = { ...fields, query };
        }
        if (parentId === row.parentId && same(fields, row.fields)) continue;
        yield* db.update(block).set({ parentId, fields, updatedAt: now }).where(eq(block.id, row.id));
      }
      if (doomed.size > 0)
        yield* db
          .update(block)
          .set({ deletedAt: now })
          .where(inArray(block.id, [...doomed]));
      yield* db.delete(source).where(notInArray(source.kind, [...SOURCE_KINDS]));
    }),
  );
});
