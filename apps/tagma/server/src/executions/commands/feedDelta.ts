import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { CommandReading } from '../contract/wire/commands.js';
import type {
  CommandFeedDelta,
  CommandFeedFrame,
  CommandFeedRows,
  CommandFeedSnapshot,
  CommandMeasured,
} from '../contract/wire/commandFeed.js';

export const commandKey = (ref: ExecutionRef): string => `${ref.execution}:${ref.incarnation}`;

const keyOf = (reading: CommandReading): string => commandKey(reading.command.execution);

export const same = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let at = 0; at < left.length; at += 1) if (!same(left[at], right[at])) return false;
    return true;
  }
  if (Array.isArray(right)) return false;
  const one = left as Record<string, unknown>;
  const other = right as Record<string, unknown>;
  let count = 0;
  for (const key in one) {
    if (one[key] === undefined) continue;
    count += 1;
    if (!same(one[key], other[key])) return false;
  }
  for (const key in other) if (other[key] !== undefined) count -= 1;
  return count === 0;
};

const measuredOf = (before: CommandReading, after: CommandReading): CommandMeasured | undefined => {
  if (before.live._tag !== 'Held' || after.live._tag !== 'Held') return undefined;
  const usage = after.live.entry.usage;
  if (usage === undefined || before.live.readAt !== after.live.readAt) return undefined;
  if (!same(before.command, after.command) || !same(before.wait, after.wait)) return undefined;
  const { usage: _before, ...held } = before.live.entry;
  const { usage: _after, ...drawn } = after.live.entry;
  for (const key of Object.keys(drawn) as (keyof typeof drawn)[]) if (!same(held[key], drawn[key])) return undefined;
  if (Object.keys(held).some((key) => !(key in drawn))) return undefined;
  return { key: keyOf(after), usage, current: after.current };
};

const rowsDelta = (before: readonly CommandReading[], after: readonly CommandReading[]): CommandFeedRows | undefined => {
  if (before.length === after.length && after.every((reading, at) => reading === before[at])) return undefined;
  const held = new Map(before.map((reading) => [keyOf(reading), reading]));
  let moved = before.length !== after.length;
  const readings: CommandReading[] = [];
  const measured: CommandMeasured[] = [];
  after.forEach((reading, at) => {
    const key = keyOf(reading);
    const standing = before[at];
    if (!moved && (standing === undefined || keyOf(standing) !== key)) moved = true;
    const was = held.get(key);
    if (was === reading) return;
    if (was === undefined) {
      readings.push(reading);
      return;
    }
    if (same(was, reading)) return;
    const sample = measuredOf(was, reading);
    if (sample !== undefined) measured.push(sample);
    else readings.push(reading);
  });
  if (!moved && readings.length === 0 && measured.length === 0) return undefined;
  return { ...(moved ? { order: after.map(keyOf) } : {}), readings, measured };
};

export const commandFeedDelta = (before: CommandFeedSnapshot, after: CommandFeedSnapshot): CommandFeedDelta | undefined => {
  const active = rowsDelta(before.active, after.active);
  const ended = rowsDelta(before.ended, after.ended);
  const delta: CommandFeedDelta = {
    composedAt: after.composedAt,
    ...(active === undefined ? {} : { active }),
    ...(ended === undefined ? {} : { ended }),
    ...(before.endedAfter === after.endedAfter ? {} : { endedAfter: after.endedAfter ?? null }),
    ...(same(before.terminals, after.terminals) ? {} : { terminals: after.terminals }),
    ...(same(before.host, after.host) ? {} : { host: after.host }),
    ...(before.stale === after.stale ? {} : { stale: after.stale }),
    ...(same(before.operationKeys, after.operationKeys) ? {} : { operationKeys: after.operationKeys }),
  };
  return Object.keys(delta).length === 1 ? undefined : delta;
};

const measuredReading = (held: CommandReading, sample: CommandMeasured): CommandReading | undefined => {
  if (held.live._tag !== 'Held') return undefined;
  const { current: _current, ...bare } = held;
  return {
    ...bare,
    live: { ...held.live, entry: { ...held.live.entry, usage: sample.usage } },
    current: sample.current,
  };
};

const appliedRows = (before: readonly CommandReading[], change: CommandFeedRows | undefined): readonly CommandReading[] | undefined => {
  if (change === undefined) return before;
  if (change.order === undefined) {
    const readings = new Map(change.readings.map((reading) => [keyOf(reading), reading]));
    const measured = new Map(change.measured.map((sample) => [sample.key, sample]));
    let found = 0;
    const rows: CommandReading[] = [];
    for (const reading of before) {
      const key = keyOf(reading);
      const replaced = readings.get(key) ?? reading;
      const sample = measured.get(key);
      const drawn = sample === undefined ? replaced : measuredReading(replaced, sample);
      if (drawn === undefined) return undefined;
      if (readings.has(key) || sample !== undefined) found += 1;
      rows.push(drawn);
    }
    return found === new Set([...readings.keys(), ...measured.keys()]).size ? rows : undefined;
  }
  const held = new Map(before.map((reading) => [keyOf(reading), reading]));
  for (const reading of change.readings) held.set(keyOf(reading), reading);
  for (const sample of change.measured) {
    const standing = held.get(sample.key);
    const drawn = standing === undefined ? undefined : measuredReading(standing, sample);
    if (drawn === undefined) return undefined;
    held.set(sample.key, drawn);
  }
  const rows: CommandReading[] = [];
  for (const key of change.order) {
    const reading = held.get(key);
    if (reading === undefined) return undefined;
    rows.push(reading);
  }
  return rows;
};

export const appliedCommandFeed = (before: CommandFeedSnapshot, delta: CommandFeedDelta): CommandFeedSnapshot | undefined => {
  const active = appliedRows(before.active, delta.active);
  const ended = appliedRows(before.ended, delta.ended);
  if (active === undefined || ended === undefined) return undefined;
  if (Object.keys(delta).length === 1 && delta.composedAt === before.composedAt) return before;
  const endedAfter = delta.endedAfter === undefined ? before.endedAfter : (delta.endedAfter ?? undefined);
  return {
    projectId: before.projectId,
    composedAt: delta.composedAt,
    active,
    ended,
    endedAfter: endedAfter,
    terminals: delta.terminals ?? before.terminals,
    host: delta.host ?? before.host,
    stale: delta.stale ?? before.stale,
    operationKeys: delta.operationKeys ?? before.operationKeys,
  };
};
