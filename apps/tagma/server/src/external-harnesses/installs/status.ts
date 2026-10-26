import { Effect, FileSystem } from 'effect';
import { hookEventsAt } from '../adapter/hookFormat.js';
import { hookFiles, type HookEntry } from './hookInstall.js';
import { handlersOf, holdsOwnHook, malformedAt, spells } from './refresh.js';
import { ownedEntry } from './targets.js';
import { dirname, join } from 'node:path';
import type { SectionCatalog } from '../../platform/contract/service/sections.js';
import { InstallFailed, installFailure } from '../../installation/contract/wire/install.js';
import { filesUnder, installedBody, sourceFiles } from './skill.js';

export type UnreadablePlace = { path: string; reason: string };

export type SkillStatus =
  | { state: 'missing'; target: string }
  | { state: 'stale'; target: string; missing: string[]; differing: string[]; extra: string[] }
  | { state: 'current'; target: string }
  | ({ state: 'unreadable'; target: string } & UnreadablePlace);

const reading = <A, E, R>(target: string, path: string, take: Effect.Effect<A, E, R>) =>
  Effect.match(take, {
    onSuccess: (value) => value,
    onFailure: (error) => ({ state: 'unreadable', target, path, reason: error instanceof Error ? error.message : String(error) }) as const,
  });

export const skillStatus = Effect.fn('harnessInstall.skillStatus')(
  function* (target: string, contributed: SectionCatalog) {
    const files = yield* FileSystem.FileSystem;
    if (!(yield* files.exists(target))) return { state: 'missing', target } as const;
    const shipped = sourceFiles();
    const shippedSet = new Set(shipped);
    const installed = yield* filesUnder(target);
    const installedSet = new Set(installed);
    const present = shipped.filter((file) => installedSet.has(file));
    const bodies = yield* Effect.forEach(present, (file) => files.readFile(join(target, file)), { concurrency: 'unbounded' });
    const differing = yield* Effect.try({
      try: () => present.filter((file, at) => !installedBody(file, contributed).equals(bodies[at]!)),
      catch: installFailure,
    });
    const missing = shipped.filter((file) => !installedSet.has(file));
    const extra = installed.filter((file) => !shippedSet.has(file));
    if (missing.length === 0 && differing.length === 0 && extra.length === 0) return { state: 'current', target } as const;
    return { state: 'stale', target, missing, differing, extra } as const;
  },
  (effect, target) => reading(target, target, effect),
);

export type HooksStatus =
  | { state: 'missing'; target: string }
  | { state: 'stale'; target: string; missing: string[]; differing: string[]; extra: string[] }
  | { state: 'current'; target: string }
  | ({ state: 'unreadable'; target: string } & UnreadablePlace);

export const hooksStatus = (repoRoot: string) =>
  Effect.forEach(
    hookFiles(),
    (group) => {
      const target = join(repoRoot, ...group.file.split('/'));
      return reading(
        target,
        target,
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          if (!(yield* files.exists(target))) return { state: 'missing', target } as const;
          const text = yield* files.readFileString(target);
          const doc: unknown = yield* Effect.try({ try: () => JSON.parse(text), catch: installFailure });
          const root = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
          const held = hookEventsAt(group.format) === 'hooks' ? root.hooks : root;
          const events = held !== null && typeof held === 'object' && !Array.isArray(held) ? (held as Record<string, unknown>) : {};
          const missing: string[] = [];
          const differing: string[] = [];
          const extra: string[] = [];
          const owed = new Set(group.entries.map((entry) => entry.event));
          let ours = 0;
          for (const event of new Set([...Object.keys(events), ...owed])) {
            if (!owed.has(event) && !holdsOwnHook(events[event])) continue;
            const standing = Array.isArray(events[event]) ? (events[event] as unknown[]) : [];
            const malformed = malformedAt(standing);
            if (malformed !== null) return yield* new InstallFailed({ detail: `a malformed entry at ${event}[${malformed}]` });
            const places = standing.flatMap((one) => handlersOf(one));
            const held = places.filter((at) => ownedEntry(at) !== null).length;
            ours += held;
            if (!owed.has(event)) {
              extra.push(event);
              continue;
            }
            const asked = group.entries.filter((entry) => entry.event === event);
            const settled = new Set<HookEntry>();
            for (const at of places) {
              const match = asked.find((entry) => !settled.has(entry) && spells(at, entry));
              if (match !== undefined) settled.add(match);
            }
            if (settled.size === asked.length && held <= asked.length) continue;
            (held === 0 ? missing : differing).push(event);
          }
          if (ours === 0) return { state: 'missing', target } as const;
          for (const asset of group.assets) {
            const path = join(dirname(target), ...asset.file.split('/'));
            if (!(yield* files.exists(path))) missing.push(asset.file);
            else if ((yield* files.readFileString(path)) !== asset.content) differing.push(asset.file);
          }
          return missing.length === 0 && differing.length === 0 && extra.length === 0
            ? ({ state: 'current', target } as const)
            : ({ state: 'stale', target, missing, differing, extra } as const);
        }),
      ).pipe(Effect.withSpan('harnessInstall.hooksStatus'));
    },
    { concurrency: 'unbounded' },
  );
