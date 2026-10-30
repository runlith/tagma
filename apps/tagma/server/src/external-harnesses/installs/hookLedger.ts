import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import type { HookTrust } from '@runlith/tagma/adapter/hook';
import { hookSurfaces, ownPlaces, type OwnPlace } from './targets.js';
import { HarnessAdapters } from '../contract/service/adapters.js';

export type HookLedger =
  | { readonly state: 'unsupported'; readonly target: string }
  | { readonly state: 'unreadable'; readonly target: string; readonly path: string; readonly reason: string }
  | {
      readonly state: 'read';
      readonly target: string;
      readonly path: string;
      readonly present: readonly string[];
      readonly absent: readonly string[];
    };

const storeOf = (descriptor: HookTrust): string =>
  join(process.env[descriptor.home] ?? join(homedir(), descriptor.folder), descriptor.file);

type Held = { readonly text: string } | { readonly missing: true } | { readonly failed: string };

const textAt = (files: FileSystem.FileSystem, path: string): Effect.Effect<Held> =>
  files.readFileString(path).pipe(
    Effect.map((text): Held => ({ text })),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed({ missing: true } as const)),
    Effect.catchTag('PlatformError', (failure) => Effect.succeed({ failed: failure.reason._tag })),
  );

const tableOf = (text: string, table: string): Record<string, unknown> | null => {
  let at: unknown;
  try {
    at = Bun.TOML.parse(text);
  } catch {
    return null;
  }
  for (const step of table.split('.')) {
    if (at === null || typeof at !== 'object') return {};
    at = (at as Record<string, unknown>)[step];
  }
  return at === undefined ? {} : at !== null && typeof at === 'object' && !Array.isArray(at) ? (at as Record<string, unknown>) : {};
};

const sorted = (
  target: string,
  path: string,
  places: readonly OwnPlace[],
  table: Record<string, unknown>,
  descriptor: HookTrust,
): HookLedger => {
  const keyed = new Map<string, boolean>();
  for (const place of places) {
    const held = Object.hasOwn(table, descriptor.key(target, place.event, place.group, place.handler));
    keyed.set(place.event, (keyed.get(place.event) ?? true) && held);
  }
  const rows = [...keyed.entries()];
  return {
    state: 'read',
    target,
    path,
    present: rows.filter(([, held]) => held).map(([event]) => event),
    absent: rows.filter(([, held]) => !held).map(([event]) => event),
  };
};

export const hookLedger = Effect.fn('harnessInstall.hookLedger')(function* (repoRoot: string) {
  const files = yield* FileSystem.FileSystem;
  const adapters = yield* HarnessAdapters;
  const rows: HookLedger[] = [];
  for (const surface of hookSurfaces(adapters.all())) {
    const target = join(repoRoot, ...surface.file.split('/'));
    const descriptor = surface.codec.file.trust;
    if (descriptor === null) {
      rows.push({ state: 'unsupported', target });
      continue;
    }
    const path = storeOf(descriptor);
    const written = yield* textAt(files, target);
    if ('failed' in written) {
      rows.push({ state: 'unreadable', target, path: target, reason: written.failed });
      continue;
    }
    const places = 'text' in written ? placesIn(written.text, surface.codec.file.events) : [];
    if (places === null) {
      rows.push({ state: 'unreadable', target, path: target, reason: 'not JSON' });
      continue;
    }
    const store = yield* textAt(files, path);
    if ('failed' in store) {
      rows.push({ state: 'unreadable', target, path, reason: store.failed });
      continue;
    }
    const table = 'text' in store ? tableOf(store.text, descriptor.table) : {};
    if (table === null) {
      rows.push({ state: 'unreadable', target, path, reason: 'not TOML' });
      continue;
    }
    rows.push(sorted(target, path, places, table, descriptor));
  }
  return rows;
});

const placesIn = (text: string, path: readonly string[]): OwnPlace[] | null => {
  try {
    return ownPlaces(JSON.parse(text) as unknown, path);
  } catch {
    return null;
  }
};
