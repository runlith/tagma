import type { HookFormat } from '@runlith/tagma/adapter/harness';
import { hookHole } from '../adapter/hookFormat.js';
import { ownedEntry, nestedOf, portableEntry } from './targets.js';
import type { HookEntry } from './hookInstall.js';

function commandsOf(standing: unknown): readonly string[] {
  if (standing === null || typeof standing !== 'object') return [];
  const row = standing as { command?: unknown; hooks?: unknown };
  const own = typeof row.command === 'string' ? [row.command] : [];
  const nested = Array.isArray(row.hooks) ? row.hooks.flatMap((one) => commandsOf(one)) : [];
  return [...own, ...nested];
}

const CLI_MENTION = /(^|[\s"'/])(?:tagma|main\.js)["']?\s+(?:hook|prime)\b/;

const waitOf = (at: Record<string, unknown>): number | undefined => (typeof at.timeout === 'number' ? at.timeout : undefined);

export const spells = (at: Record<string, unknown>, entry: HookEntry): boolean =>
  at.command === entry.command && waitOf(at) === entry.timeout;

type CommandPlace = {
  readonly at: Record<string, unknown>;
  readonly group: Record<string, unknown>;
  readonly matcher: string | null;
  readonly onlyHandler: boolean;
  readonly behindInGroup: boolean;
  readonly laterForeign: boolean;
};

export function malformedAt(held: readonly unknown[]): number | null {
  for (const [index, group] of held.entries()) {
    if (group === null || typeof group !== 'object' || Array.isArray(group)) return index;
    const nested = (group as Record<string, unknown>).hooks;
    if (nested === undefined) continue;
    if (!Array.isArray(nested)) return index;
    if (nested.some((entry) => entry === null || typeof entry !== 'object' || Array.isArray(entry))) return index;
  }
  return null;
}

export const handlersOf = (group: unknown): Record<string, unknown>[] => {
  if (group === null || typeof group !== 'object') return [];
  return nestedOf(group as Record<string, unknown>).filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null && typeof entry === 'object' && typeof (entry as Record<string, unknown>).command === 'string',
  );
};

export const holdsOwnHook = (held: unknown): boolean =>
  Array.isArray(held) && held.some((group) => handlersOf(group).some((at) => ownedEntry(at) !== null));

function commandPlaces(held: readonly unknown[]): CommandPlace[] {
  const groups = held.filter((group): group is Record<string, unknown> => group !== null && typeof group === 'object');
  const foreign = (at: Record<string, unknown>): boolean => ownedEntry(at) === null;
  const places: CommandPlace[] = [];
  groups.forEach((group, index) => {
    const handlers = handlersOf(group);
    handlers.forEach((at, handler) => {
      places.push({
        at,
        group,
        matcher: typeof group.matcher === 'string' ? group.matcher : null,
        onlyHandler: handlers.length === 1,
        behindInGroup: handlers.slice(handler + 1).some(foreign),
        laterForeign: groups.slice(index + 1).some((later) => handlersOf(later).some(foreign)),
      });
    });
  });
  return places;
}

type Refresh = { readonly changed: boolean; readonly deferred: readonly string[] };

export function refreshStale(held: unknown[], format: HookFormat, event: string, asked: readonly HookEntry[]): Refresh {
  const places = commandPlaces(held);
  const settled = new Set<HookEntry>();
  const keeping = new Set<Record<string, unknown>>();
  for (const place of places) {
    const match = asked.find((entry) => !settled.has(entry) && spells(place.at, entry));
    if (match === undefined) continue;
    settled.add(match);
    keeping.add(place.at);
  }
  const owed = asked.filter((entry) => !settled.has(entry));
  const deferred: string[] = [];
  const empty = new Set<Record<string, unknown>>();
  const drop = new Set<Record<string, unknown>>();
  let changed = false;
  for (const place of places) {
    if (ownedEntry(place.at) === null) {
      if (typeof place.at.command === 'string' && CLI_MENTION.test(place.at.command)) {
        deferred.push(`${event}: a command of your own runs tagma — ${place.at.command}`);
      }
      continue;
    }
    if (keeping.has(place.at)) continue;
    const next = owed.shift();
    if (next !== undefined) {
      place.at.command = next.command;
      if (next.timeout === undefined) delete place.at.timeout;
      else place.at.timeout = next.timeout;
      changed = true;
      if (place.matcher !== null) deferred.push(`${event}: our hook stands under your matcher ${JSON.stringify(place.matcher)}`);
      continue;
    }
    if (place.behindInGroup || (place.onlyHandler && place.laterForeign && !hookHole(format))) {
      const current = asked[0];
      const command = current?.command ?? portableEntry(place.at);
      if (current !== undefined && waitOf(place.at) !== current.timeout) {
        if (current.timeout === undefined) delete place.at.timeout;
        else place.at.timeout = current.timeout;
        changed = true;
      }
      if (command !== null && command !== place.at.command) {
        place.at.command = command;
        changed = true;
      }
      deferred.push(`${event}: a stale hook of ours cannot be removed without moving a command of yours — ${place.at.command}`);
      continue;
    }
    if (place.onlyHandler && place.laterForeign) {
      empty.add(place.group);
    } else {
      drop.add(place.at);
    }
    changed = true;
  }
  for (const group of empty) group.hooks = [];
  if (drop.size > 0) removeHandlers(held, drop);
  return { changed, deferred };
}

function removeHandlers(held: unknown[], drop: ReadonlySet<Record<string, unknown>>): void {
  const dropped = (entry: unknown): boolean => entry !== null && typeof entry === 'object' && drop.has(entry as Record<string, unknown>);
  const retain = (group: unknown): unknown => {
    if (group === null || typeof group !== 'object') return group;
    const row = group as Record<string, unknown>;
    if (drop.has(row)) return undefined;
    const nested = row.hooks;
    if (!Array.isArray(nested)) return group;
    const kept = nested.filter((entry) => !dropped(entry));
    if (kept.length === 0 && nested.length > 0) return undefined;
    return kept.length === nested.length ? group : { ...row, hooks: kept };
  };
  const next = held.map(retain).filter((entry) => entry !== undefined);
  if (next.length !== held.length || next.some((entry, i) => entry !== held[i])) held.splice(0, held.length, ...next);
}
