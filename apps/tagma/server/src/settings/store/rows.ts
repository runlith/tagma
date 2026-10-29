import { and, eq, isNull, or } from 'drizzle-orm';
import { Clock, Effect, Result, Schema } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import type { WriterRegister } from '../../platform/contract/service/writers.js';
import type { SessionRef } from '../../platform/contract/wire/session.js';
import type { SettableScope, SettingKey } from '../../platform/contract/wire/setting.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Resolved } from '../contract/service/values.js';
import { resolveSetting, type SettingLayer } from '../resolution.js';
import { setting } from './table.js';

type SettingRow = typeof setting.$inferSelect;
type SettingValueRow = Pick<SettingRow, 'scope' | 'key' | 'value' | 'declined'>;

export const layers = Effect.fn('Settings.layers')(function* (
  db: StoreDb<'graph'>,
  sessions: WriterRegister['Service'],
  projectId?: number,
  keyId?: string,
): Effect.fn.Return<SettingLayer[], StoreFailure> {
  const keyed = (scoped: ReturnType<typeof and>) => (keyId === undefined ? scoped : and(eq(setting.key, keyId), scoped));
  const user = yield* db
    .select()
    .from(setting)
    .where(keyed(and(eq(setting.scope, 'user'), isNull(setting.projectId))));
  const project =
    projectId === undefined
      ? []
      : yield* db
          .select()
          .from(setting)
          .where(keyed(and(eq(setting.scope, 'project'), eq(setting.projectId, projectId))));
  const wrote = new Map<number, SessionRef>();
  const signed = [...user, ...project].map((row) => row.sessionId).filter((id): id is number => id !== null);
  for (const row of signed.length === 0 ? [] : yield* sessions.named(signed)) {
    wrote.set(row.id, { harness: row.harness, key: row.key });
  }
  return [layerOf('user', user, wrote), layerOf('project', project, wrote)];
});

export const valueRows = (db: StoreDb<'graph'>, projectId: number | undefined, keyId?: string) => {
  const scoped =
    projectId === undefined
      ? and(eq(setting.scope, 'user'), isNull(setting.projectId))
      : or(and(eq(setting.scope, 'user'), isNull(setting.projectId)), and(eq(setting.scope, 'project'), eq(setting.projectId, projectId)));
  return db
    .select({ scope: setting.scope, key: setting.key, value: setting.value, declined: setting.declined })
    .from(setting)
    .where(keyId === undefined ? scoped : and(eq(setting.key, keyId), scoped))
    .pipe(Effect.map((rows) => [valueLayerOf('user', rows), valueLayerOf('project', rows)]));
};

export const rowOf = (keyId: string, scope: SettableScope, projectId: number | null) =>
  and(eq(setting.scope, scope), eq(setting.key, keyId), projectId === null ? isNull(setting.projectId) : eq(setting.projectId, projectId));

export const standingRow = (db: StoreDb<'graph'>, keyId: string, scope: SettableScope, projectId: number | null) =>
  db
    .select({ value: setting.value, declined: setting.declined })
    .from(setting)
    .where(rowOf(keyId, scope, projectId))
    .pipe(Effect.map((rows) => rows[0] ?? { value: null, declined: false }));

export const storedValue = (key: SettingKey<unknown>, offered: unknown, declined: boolean, beneath: Resolved<unknown>): string | null => {
  const echoesBeneath =
    key.merge === 'replace' &&
    offered !== undefined &&
    !declined &&
    JSON.stringify(offered) === JSON.stringify(Schema.encodeSync(key.schema)(beneath.value as never));
  return offered === undefined || echoesBeneath ? null : JSON.stringify(offered);
};

export const scopeRows = Effect.fnUntraced(function* <A>(
  db: StoreDb<'graph'>,
  key: SettingKey<A>,
  scope: SettableScope,
  projectId: number | null,
): Effect.fn.Return<{ readonly value: A; readonly spare: readonly unknown[] }, StoreFailure | GateRefusal<'setting-value'>> {
  const rows = yield* db
    .select({ value: setting.value })
    .from(setting)
    .where(rowOf(key.id, scope, projectId));
  const stored = rows[0]?.value;
  if (stored === undefined || stored === null) return { value: key.fallback, spare: [] };
  const parsed: unknown = JSON.parse(stored);
  if (key.member !== undefined) {
    const readable = Schema.decodeUnknownResult(key.member);
    const spare = Array.isArray(parsed) ? parsed.filter((member) => Result.isFailure(readable(member))) : [];
    return {
      value: resolveSetting(key, [{ scope, values: new Map([[key.id, parsed]]), declined: new Set(), writers: new Map() }]).value,
      spare,
    };
  }
  const decoded = Schema.decodeUnknownResult(key.schema)(parsed);
  if (Result.isFailure(decoded)) {
    return yield* new GateRefusal(
      'setting-value',
      `The value stored for ${key.id} in ${scope} scope is not what it holds, so nothing can be derived from it: ${decoded.failure.message}`,
      [`clear it with write_setting naming ${key.id} and no value, then write it again`],
    );
  }
  return { value: decoded.success, spare: [] };
});

export const storeRow = Effect.fn('Settings.storeRow')(function* (
  db: StoreDb<'graph'>,
  sessions: WriterRegister['Service'],
  unit: WriteUnit<'graph'>,
  keyId: string,
  scope: SettableScope,
  projectId: number | null,
  stored: string | null,
  declined: boolean,
): Effect.fn.Return<void, StoreFailure> {
  const where = rowOf(keyId, scope, projectId);
  if (stored === null && !declined) {
    yield* db.delete(setting).where(where);
    return;
  }
  const sessionId = yield* sessions.signedId(unit);
  const existing = yield* db.select({ id: setting.id }).from(setting).where(where);
  if (existing.length > 0) {
    yield* db
      .update(setting)
      .set({ value: stored, declined, sessionId, updatedAt: new Date(yield* Clock.currentTimeMillis) })
      .where(where);
  } else {
    yield* db
      .insert(setting)
      .values({ scope, projectId, key: keyId, value: stored, declined, sessionId, updatedAt: new Date(yield* Clock.currentTimeMillis) });
  }
});

export const purgeProject = (db: StoreDb<'graph'>, projectId: number) =>
  Effect.asVoid(db.delete(setting).where(eq(setting.projectId, projectId)));

function valueLayerOf(scope: SettableScope, rows: readonly SettingValueRow[]): SettingLayer {
  const values = new Map<string, unknown>();
  const declined = new Set<string>();
  for (const row of rows) {
    if (row.scope !== scope) continue;
    if (row.declined) declined.add(row.key);
    if (row.value !== null) values.set(row.key, JSON.parse(row.value));
  }
  return { scope, values, declined, writers: new Map() };
}

function layerOf(scope: SettableScope, rows: readonly SettingRow[], wrote: ReadonlyMap<number, SessionRef>): SettingLayer {
  const values = new Map<string, unknown>();
  const declined = new Set<string>();
  const writers = new Map<string, SessionRef>();
  for (const row of rows) {
    if (row.declined) declined.add(row.key);
    const writer = row.sessionId === null ? undefined : wrote.get(row.sessionId);
    if (writer !== undefined) writers.set(row.key, writer);
    if (row.value === null) continue;
    values.set(row.key, JSON.parse(row.value));
  }
  return { scope, values, declined, writers };
}
