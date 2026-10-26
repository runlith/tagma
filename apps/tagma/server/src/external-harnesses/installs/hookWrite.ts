import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { HookAsset, HookFormat } from '../contract/service/adapter.js';
import { hookEntry, hookEventsAt, hookFileKeys } from '../adapter/hookFormat.js';
import { InstallFailed, installFailure } from '../../installation/contract/wire/install.js';
import { hookFiles, type HookEntry, type HooksWrite } from './hookInstall.js';
import { handlersOf, malformedAt, refreshStale, spells, holdsOwnHook } from './refresh.js';

export type HooksPlan = { readonly result: HooksWrite; readonly text: string | null };

export const planHooks = (repoRoot: string): Effect.Effect<HooksPlan[], InstallFailed> =>
  Effect.map(
    Effect.forEach(hookFiles(), (group) =>
      planHookFiles(join(repoRoot, ...group.file.split('/')), group.format, group.entries, group.assets),
    ),
    (groups) => groups.flat(),
  );

export const planHookFiles = Effect.fnUntraced(function* (
  filePath: string,
  format: HookFormat,
  entries: HookEntry[],
  assets: readonly HookAsset[] = [],
) {
  const plans: HooksPlan[] = [yield* planHooksFile(filePath, format, entries)];
  for (const asset of assets) {
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

export const installHooks = (repoRoot: string): Effect.Effect<HooksWrite[], InstallFailed> =>
  Effect.flatMap(planHooks(repoRoot), applyHooks);

export const writeHooksFile = (filePath: string, format: HookFormat, entries: HookEntry[]): Effect.Effect<HooksWrite, InstallFailed> =>
  Effect.flatMap(planHooksFile(filePath, format, entries), applyHooksPlan);

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

export const planHooksFile = Effect.fn('harnessInstall.planHooks')(function* (filePath: string, format: HookFormat, entries: HookEntry[]) {
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
  for (const [key, value] of Object.entries(hookFileKeys(format))) {
    if (root[key] !== undefined) continue;
    root[key] = value;
    changed = true;
  }
  const nested = hookEventsAt(format) === 'hooks';
  if (nested && root.hooks === undefined) root.hooks = {};
  const holder = nested ? root.hooks : root;
  if (holder === null || typeof holder !== 'object' || Array.isArray(holder)) {
    return yield* refuse(`${filePath} holds "hooks" that is not an object`);
  }
  const events = holder as Record<string, unknown>;
  const owed = new Set(entries.map((entry) => entry.event));
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
  const deferred: string[] = [];
  for (const event of touching) {
    const held = events[event];
    if (!Array.isArray(held)) continue;
    const refresh = refreshStale(
      held,
      format,
      event,
      entries.filter((entry) => entry.event === event),
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
  for (const entry of entries) {
    if (events[entry.event] === undefined) events[entry.event] = [];
    const held = events[entry.event];
    if (!Array.isArray(held)) return yield* refuse(`${filePath} holds "${entry.event}" that is not an array`);
    if (held.some((standing) => handlersOf(standing as Record<string, unknown>).some((at) => spells(at, entry)))) continue;
    held.push(hookEntry(format, entry.command, entry.timeout));
    changed = true;
  }
  const said = deferred.length === 0 ? {} : { deferred };
  if (!changed && existed) return { result: { path: filePath, write: 'current', ...said }, text: null } as const;
  return {
    result: { path: filePath, write: existed ? 'updated' : 'created', ...said },
    text: `${JSON.stringify(root, null, 2)}\n`,
  } as const;
});
