import { Clock, Effect } from 'effect';
import { and, eq, isNull } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { CATALOG_DECLARATION, TAG_DECLARATION } from '../contract/wire/tags/declaration.js';
import { block } from '../store/tables.js';

const stepping = writes('Tree.step.reachLeaves', [block]);

const REACH = 'reach';
const REACH_SCHEMA = 'projectReach';
const REACH_TEXT =
  'rules in the global graph bind every project, and one whose reach is `code` binds only the projects that work on code — set it on a rule about code, leave it unset on one about how an agent works.';
const PRIOR_TEXT = 'rules in the global graph bind across projects.';

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const text = (value: string): string => value.replaceAll(REACH_TEXT, PRIOR_TEXT);

function reachFields(declaration: Raw): readonly string[] {
  if (!isRecord(declaration.fields)) return [];
  return Object.entries(declaration.fields).flatMap(([name, type]) =>
    isRecord(type) && type.type === 'schema' && type.name === REACH_SCHEMA ? [name] : [],
  );
}

function declaration(value: Raw): Raw {
  const out: Raw = { ...value };
  const dropped = reachFields(value);
  if (dropped.length > 0 && isRecord(out.fields)) {
    out.fields = Object.fromEntries(Object.entries(out.fields).filter(([name]) => !dropped.includes(name)));
  }
  if (isRecord(out.roles) && Object.hasOwn(out.roles, REACH)) {
    const { [REACH]: _reach, ...roles } = out.roles;
    out.roles = roles;
  }
  if (typeof out.prompt === 'string') out.prompt = text(out.prompt);
  return out;
}

function catalog(value: Raw): Raw {
  if (!isRecord(value.release) || !Array.isArray(value.release.tags)) return value;
  return { ...value, release: { ...value.release, tags: value.release.tags.map((tag) => (isRecord(tag) ? declaration(tag) : tag)) } };
}

function carried(fields: Raw, gone: ReadonlySet<string>): Raw {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => !gone.has(name)));
}

export const reachLeaves = Effect.fn('GraphStep.reachLeaves')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const rows = yield* db
    .select({ id: block.id, tags: block.tags, fields: block.fields, body: block.body })
    .from(block)
    .where(and(eq(block.projectId, project.id), isNull(block.deletedAt)));
  const dropped = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.tags.includes(TAG_DECLARATION.id) || typeof row.fields.id !== 'string') continue;
    const names = reachFields(row.fields);
    if (names.length > 0) dropped.set(row.fields.id, new Set(names));
  }
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const row of rows) {
        const declaring = row.tags.includes(TAG_DECLARATION.id);
        const listing = row.tags.includes(CATALOG_DECLARATION.id);
        const gone = new Set(row.tags.flatMap((tag) => [...(dropped.get(tag) ?? [])]));
        const fields = declaring
          ? declaration(row.fields)
          : listing
            ? catalog(row.fields)
            : gone.size > 0
              ? carried(row.fields, gone)
              : row.fields;
        const body = declaring ? text(row.body) : row.body;
        if (same(fields, row.fields) && body === row.body) continue;
        yield* db.update(block).set({ fields, body, updatedAt: now }).where(eq(block.id, row.id));
      }
    }),
  );
});
