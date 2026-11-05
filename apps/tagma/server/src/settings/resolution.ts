import { Result, Schema } from 'effect';
import type { SessionRef } from '../platform/contract/wire/session.js';
import {
  SETTABLE_SCOPES,
  type SettableScope,
  type SettingKey,
  type SettingControlReader,
  type SettingLayerAnswerOf,
  type SettingMerge,
  type SettingScope,
} from '../platform/contract/wire/setting.js';
import { type SettingEntry, type SettingRejection } from './contract/wire/catalog.js';
import type { Resolved } from './contract/service/values.js';
import type { ChangeRecord } from '../platform/contract/wire/actor.js';
import { shapeOf } from './shape.js';

export type SettingLayer = {
  readonly scope: SettableScope;
  readonly values: ReadonlyMap<string, unknown>;
  readonly declined: ReadonlySet<string>;
  readonly writers: ReadonlyMap<string, SessionRef>;
  readonly changes?: ReadonlyMap<string, ChangeRecord>;
};

type Decoders = {
  readonly whole: (stored: unknown) => Result.Result<unknown, { readonly message: string }>;
  readonly member: ((stored: unknown) => Result.Result<unknown, { readonly message: string }>) | undefined;
  readonly accepts: ReadonlySet<string>;
};

const decoders = new WeakMap<SettingKey<unknown>, Decoders>();

const decodersOf = (key: SettingKey<unknown>): Decoders => {
  const held = decoders.get(key);
  if (held !== undefined) return held;
  const built: Decoders = {
    whole: Schema.decodeUnknownResult(key.schema),
    member: key.member === undefined ? undefined : Schema.decodeUnknownResult(key.member),
    accepts: new Set(key.scopes),
  };
  decoders.set(key, built);
  return built;
};

export function resolveSetting<A>(key: SettingKey<A>, layers: readonly SettingLayer[]): Resolved<A> {
  const { whole: decode, member: decodeMember, accepts } = decodersOf(key as SettingKey<unknown>);
  const rejections: SettingRejection[] = [];
  const answered: { [S in SettableScope]?: SettingLayerAnswerOf<A> } = {};
  let value = key.fallback;
  let from: SettingScope = 'default';
  let writer: SessionRef | undefined;
  let changed: ChangeRecord | undefined;

  for (const scope of SETTABLE_SCOPES) {
    if (!accepts.has(scope)) continue;
    for (const layer of layers) {
      if (layer.scope !== scope) continue;
      const change = layer.changes?.get(key.id);
      if (change !== undefined && (changed === undefined || change.at >= changed.at)) changed = change;
      const declined = layer.declined.has(key.id);
      if (declined) {
        value = key.fallback;
        from = 'default';
        writer = undefined;
      }
      if (!layer.values.has(key.id)) {
        if (declined) answered[scope] = { declined };
        continue;
      }
      const read =
        decodeMember === undefined
          ? readWhole(key, scope, decode as (stored: unknown) => Result.Result<A, { readonly message: string }>, layer.values.get(key.id))
          : readMembers(key, scope, decodeMember, layer.values.get(key.id));
      rejections.push(...read.rejections);
      const wrote = layer.writers.get(key.id);
      answered[scope] = {
        value: read.value,
        declined,
        writer: wrote,
      };
      if (read.value === undefined) continue;
      value = from === 'default' ? read.value : merge(key.merge, value, read.value);
      from = scope;
      writer = wrote;
    }
  }

  return { value, from, writer, changed, layers: answered, rejections };
}

type Read<A> = { readonly value?: A; readonly rejections: readonly SettingRejection[] };

function readWhole<A>(
  key: SettingKey<A>,
  scope: SettableScope,
  decode: (stored: unknown) => Result.Result<A, { readonly message: string }>,
  stored: unknown,
): Read<A> {
  const decoded = decode(stored);
  if (Result.isFailure(decoded)) return { rejections: [{ key: key.id, scope, reason: decoded.failure.message }] };
  return { value: decoded.success, rejections: [] };
}

function memberNamed(member: unknown): string {
  if (typeof member !== 'object' || member === null) return '';
  const name = (member as { name?: unknown }).name;
  return typeof name === 'string' ? ` (${name})` : '';
}

function readMembers<A>(
  key: SettingKey<A>,
  scope: SettableScope,
  decode: (stored: unknown) => Result.Result<unknown, { readonly message: string }>,
  stored: unknown,
): Read<A> {
  if (key.member === undefined || !Array.isArray(stored)) {
    return { rejections: [{ key: key.id, scope, reason: 'the stored value is not a list' }] };
  }
  const rejections: SettingRejection[] = [];
  const kept: unknown[] = [];
  for (const [at, member] of stored.entries()) {
    const decoded = decode(member);
    if (Result.isFailure(decoded)) {
      rejections.push({
        key: key.id,
        scope,
        reason: `entry ${at + 1}${memberNamed(member)}: ${decoded.failure.message}`,
      });
      continue;
    }
    kept.push(decoded.success);
  }
  return { value: kept as A, rejections };
}

export function resolveCatalog(
  keys: readonly SettingKey<unknown>[],
  layers: readonly SettingLayer[],
  controls?: ReadonlyMap<string, SettingControlReader>,
): { entries: SettingEntry[]; rejections: SettingRejection[] } {
  const entries: SettingEntry[] = [];
  const rejections: SettingRejection[] = [];
  for (const key of keys) {
    const resolved = resolveSetting(key, layers);
    entries.push({
      id: key.id,
      section: key.section,
      title: key.title,
      description: key.description,
      shape: shapeOf(key),
      control: controls?.get(key.id)?.() ?? key.control,
      scopes: key.scopes,
      merge: key.merge,
      value: resolved.value,
      from: resolved.from,
      fallback: key.fallback,
      layers: resolved.layers,
      writer: resolved.writer,
      operatorOnly: key.operatorOnly === true ? (true as const) : undefined,
    });
    rejections.push(...resolved.rejections);
  }
  return { entries, rejections };
}

function merge<A>(strategy: SettingMerge, weaker: A, stronger: A): A {
  switch (strategy) {
    case 'replace':
      return stronger;
    case 'concat':
      return Array.isArray(weaker) && Array.isArray(stronger) ? ([...weaker, ...stronger] as A) : stronger;
    case 'union':
      return Array.isArray(weaker) && Array.isArray(stronger) ? (unique([...weaker, ...stronger]) as A) : stronger;
  }
}

function unique(entries: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const kept: unknown[] = [];
  for (const entry of entries) {
    const identity = typeof entry === 'string' ? entry : JSON.stringify(entry);
    if (seen.has(identity)) continue;
    seen.add(identity);
    kept.push(entry);
  }
  return kept;
}
