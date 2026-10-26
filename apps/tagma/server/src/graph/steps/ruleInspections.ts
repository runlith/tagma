import { and, eq, inArray, like } from 'drizzle-orm';
import { Clock, Effect, Option, Schema } from 'effect';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { Tags } from '../contract/service/vocabulary.js';
import { blockName } from '../contract/wire/references.js';
import { block, event } from '../store/tables.js';
import { object, type Raw } from './documents.js';

const stepping = writes('Tree.step.ruleInspections', [block, event]);

const KEY = /^[a-z][a-z0-9-]*$/u;

const STRICTNESS: ReadonlySet<unknown> = new Set(['note', 'watch', 'gate']);

const NAMESPACED = /^(\S+) [0-9a-f]{64} ([\s\S]*)$/u;

const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

type Check = { readonly builtin?: unknown; readonly runner?: unknown; readonly id?: unknown };

type Stored = Raw & { readonly checks: readonly Check[] };

const storedOf = (value: unknown): Stored | null =>
  object(value) && STRICTNESS.has(value.strictness) && Array.isArray(value.checks) && value.checks.every(object) ? (value as Stored) : null;

const idOf = (document: Stored): string | null => {
  const [only, ...rest] = document.checks;
  if (only === undefined || rest.length > 0) return null;
  const id = typeof only.builtin === 'string' ? only.builtin : only.id;
  return typeof id === 'string' ? id : null;
};

const rewritten = (fingerprint: unknown, key: string): unknown => {
  if (typeof fingerprint !== 'string') return fingerprint;
  const found = NAMESPACED.exec(fingerprint);
  if (found === null) return fingerprint;
  return found[1]!.includes(':') ? `${key} ${found[2]}` : found[2];
};

const entries = (value: unknown, key: string): unknown =>
  Array.isArray(value)
    ? value.map((entry) => (object(entry) ? { ...entry, fingerprint: rewritten(entry.fingerprint, key) } : entry))
    : value;

export const ruleInspections = Effect.fn('GraphStep.ruleInspections')(function* (project: ProjectRow) {
  const store = yield* GraphStore;
  const { db } = store;
  const table = yield* (yield* Tags).of(project.id);
  const rows = yield* db
    .select({ id: block.id, uuid: block.uuid, tags: block.tags, fields: block.fields, deletedAt: block.deletedAt })
    .from(block)
    .where(and(eq(block.projectId, project.id), like(block.fields, '%"checks"%')));
  const documents = rows.flatMap((row) => {
    const field = table.lawProjection(row)?.enforcement?.field;
    const stored = field === undefined ? null : storedOf(row.fields[field]);
    return field === undefined || stored === null ? [] : [{ row, field, stored }];
  });
  const events = yield* db
    .select({ id: event.id, blockId: event.blockId, payload: event.payload })
    .from(event)
    .where(and(eq(event.projectId, project.id), inArray(event.op, ['enforce', 'remeasure', 'update']), like(event.payload, '%"checks"%')));
  if (documents.length === 0 && events.length === 0) return;
  const named = new Map<string, number>();
  for (const { row, stored } of documents) {
    const id = row.deletedAt === null ? idOf(stored) : null;
    if (id !== null) named.set(id, (named.get(id) ?? 0) + 1);
  }
  const keyOf = (stored: Stored, uuid: string): string => {
    const id = idOf(stored);
    const key = id === null ? null : (named.get(id) ?? 0) > 1 ? `${id}-${blockName(uuid)}` : id;
    return key !== null && KEY.test(key) ? key : `rule-${blockName(uuid)}`;
  };
  const translated = (stored: Stored, uuid: string): Raw => {
    const { checks: _checks, ...rest } = stored;
    const key = keyOf(stored, uuid);
    return { ...rest, inspection: key, debt: entries(stored.debt, key), escaped: entries(stored.escaped, key) };
  };
  const uuids = new Map(rows.map((row) => [row.id, row.uuid] as const));
  const missing = [...new Set(events.flatMap((one) => (one.blockId === null || uuids.has(one.blockId) ? [] : [one.blockId])))];
  for (let at = 0; at < missing.length; at += 500) {
    for (const row of yield* db
      .select({ id: block.id, uuid: block.uuid })
      .from(block)
      .where(inArray(block.id, missing.slice(at, at + 500))))
      uuids.set(row.id, row.uuid);
  }
  const translatedIn = (value: unknown, uuid: string): unknown => {
    const stored = storedOf(value);
    return stored === null ? value : translated(stored, uuid);
  };
  yield* store.transaction(stepping, () =>
    Effect.gen(function* () {
      const now = new Date(yield* Clock.currentTimeMillis);
      for (const { row, field, stored } of documents) {
        yield* db
          .update(block)
          .set({ fields: { ...row.fields, [field]: translated(stored, row.uuid) }, updatedAt: now })
          .where(eq(block.id, row.id));
      }
      for (const one of events) {
        const uuid = one.blockId === null ? undefined : uuids.get(one.blockId);
        if (uuid === undefined) continue;
        const read = parsed(one.payload);
        if (Option.isNone(read) || !object(read.value)) continue;
        const payload = read.value;
        const next: Raw = { ...payload };
        if ('was' in payload) next.was = translatedIn(payload.was, uuid);
        if (object(payload.wasFields))
          next.wasFields = Object.fromEntries(Object.entries(payload.wasFields).map(([key, value]) => [key, translatedIn(value, uuid)]));
        const text = JSON.stringify(next);
        if (text !== JSON.stringify(payload)) yield* db.update(event).set({ payload: text }).where(eq(event.id, one.id));
      }
    }),
  );
});
