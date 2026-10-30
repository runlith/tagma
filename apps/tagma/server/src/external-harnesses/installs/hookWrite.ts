import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { HookAsset } from '@runlith/tagma/adapter/harness';
import type { HookCodec } from '@runlith/tagma/adapter/hook';
import { InstallFailed, installFailure } from '../../installation/contract/wire/install.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import { hookFiles, type HookEntry, type HooksWrite } from './hookInstall.js';
import { handlersOf, malformedAt, refreshStale, spells, holdsOwnHook } from './refresh.js';

export type HooksPlan = { readonly result: HooksWrite; readonly text: string | null };

export type HookTarget = {
  readonly path: string;
  readonly codec: HookCodec;
  readonly entries: readonly HookEntry[];
  readonly assets: readonly HookAsset[];
};

export const planHooks = Effect.fnUntraced(function* (repoRoot: string) {
  const adapters = yield* HarnessAdapters;
  return yield* planHookTargets(hookFiles(adapters.all()).map((group) => ({ ...group, path: join(repoRoot, ...group.file.split('/')) })));
});

export const planHookTargets = Effect.fnUntraced(function* (targets: readonly HookTarget[]) {
  const byPath = new Map<string, HookTarget[]>();
  for (const target of targets) {
    const groups = byPath.get(target.path) ?? [];
    groups.push(target);
    byPath.set(target.path, groups);
  }
  const plans = yield* Effect.forEach([...byPath], ([path, groups]) => planHookFiles(path, groups));
  return plans.flat();
});

const planHookFiles = Effect.fnUntraced(function* (filePath: string, targets: readonly HookTarget[]) {
  const plans: HooksPlan[] = [yield* planHooksFile(filePath, targets)];
  for (const asset of targets.flatMap((target) => target.assets)) {
    const path = join(dirname(filePath), ...asset.file.split('/'));
    const existed = existsSync(path);
    const held = existed ? yield* Effect.try({ try: () => readFileSync(path, 'utf8'), catch: installFailure }) : null;
    plans.push({
      result: { path, write: held === asset.content ? 'current' : existed ? 'updated' : 'created' },
      text: held === asset.content ? null : asset.content,
    });
  }
  return plans;
});

export const applyHooks = (plans: readonly HooksPlan[]): Effect.Effect<HooksWrite[], InstallFailed> =>
  Effect.forEach(plans, applyHooksPlan);

export const installHooks = (repoRoot: string): Effect.Effect<HooksWrite[], InstallFailed, HarnessAdapters> =>
  Effect.flatMap(planHooks(repoRoot), applyHooks);

export const applyHooksPlan = ({ result, text }: HooksPlan): Effect.Effect<HooksWrite, InstallFailed> =>
  text === null
    ? Effect.succeed(result)
    : Effect.try({
        try: () => {
          mkdirSync(dirname(result.path), { recursive: true });
          writeFileSync(result.path, text);
          return result;
        },
        catch: installFailure,
      }).pipe(Effect.withSpan('harnessInstall.applyHooksPlan'));

const planHooksFile = Effect.fn('harnessInstall.planHooks')(function* (filePath: string, targets: readonly HookTarget[]) {
  const refuse = (detail: string) => new InstallFailed({ detail });
  const existed = existsSync(filePath);
  const text = existed ? yield* Effect.try({ try: () => readFileSync(filePath, 'utf8'), catch: installFailure }) : '';
  const doc: unknown =
    text.trim().length === 0
      ? {}
      : yield* Effect.try({
          try: () => JSON.parse(text),
          catch: () => refuse(`${filePath} is not JSON; fix it, or add the tagma hooks by hand`),
        });
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return yield* refuse(`${filePath} does not hold a JSON object`);
  }
  const root = doc as Record<string, unknown>;
  let changed = false;
  const deferred: string[] = [];
  const byHolder = new Map<string, HookTarget[]>();
  for (const target of targets) {
    const key = JSON.stringify(target.codec.file.events);
    const sharing = byHolder.get(key) ?? [];
    sharing.push(target);
    byHolder.set(key, sharing);
  }
  for (const sharing of byHolder.values()) {
    const codec = sharing[0]!.codec;
    for (const target of sharing) {
      for (const [key, value] of Object.entries(target.codec.file.keys)) {
        if (root[key] !== undefined) continue;
        root[key] = value;
        changed = true;
      }
    }
    let events: Record<string, unknown> = root;
    for (const step of codec.file.events) {
      if (events[step] === undefined) events[step] = {};
      const next = events[step];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        return yield* refuse(`${filePath} holds "${step}" that is not an object`);
      }
      events = next as Record<string, unknown>;
    }
    const shared = sharing.flatMap((target) => target.entries);
    const owed = new Set(shared.map((entry) => entry.event));
    const touching = [...new Set([...Object.keys(events), ...owed])].filter((event) => owed.has(event) || holdsOwnHook(events[event]));
    for (const event of touching) {
      const held = events[event];
      if (held === undefined) continue;
      if (!Array.isArray(held)) return yield* refuse(`${filePath} holds "${event}" that is not an array`);
      const malformed = malformedAt(held);
      if (malformed !== null) {
        return yield* refuse(`${filePath} holds a malformed entry at ${event}[${malformed}]; fix it, or add the tagma hooks by hand`);
      }
    }
    for (const event of touching) {
      const held = events[event];
      if (!Array.isArray(held)) continue;
      const refresh = refreshStale(
        held,
        sharing.every((target) => target.codec.file.holes),
        event,
        shared.filter((entry) => entry.event === event),
      );
      if (refresh.changed) changed = true;
      deferred.push(...refresh.deferred);
    }
    for (const event of touching) {
      const held = events[event];
      if (owed.has(event) || !Array.isArray(held) || held.length > 0) continue;
      delete events[event];
      changed = true;
    }
    for (const target of sharing) {
      for (const entry of target.entries) {
        if (events[entry.event] === undefined) events[entry.event] = [];
        const held = events[entry.event];
        if (!Array.isArray(held)) return yield* refuse(`${filePath} holds "${entry.event}" that is not an array`);
        if (held.some((standing) => handlersOf(standing as Record<string, unknown>).some((at) => spells(at, entry)))) continue;
        held.push(target.codec.file.entry(entry.command, entry.timeout));
        changed = true;
      }
    }
  }
  const said = deferred.length === 0 ? {} : { deferred };
  if (!changed && existed) return { result: { path: filePath, write: 'current', ...said }, text: null } as const;
  return {
    result: { path: filePath, write: existed ? 'updated' : 'created', ...said },
    text: `${JSON.stringify(root, null, 2)}\n`,
  } as const;
});
