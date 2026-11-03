import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { unique } from '@runlith/utils/collection';
import { workingFilesAt } from '@runlith/git/working';
import type { Git } from '@runlith/git/Git';
import { configuredGit } from '../../platform/git/ownGit.js';
import type { PreparedFns } from '../contract/service/prepared.js';
import type { BoundTexts, ImportedUse } from './dependencyWalk.js';
import { changedAmong } from './team.js';

type NeedPlace = { readonly git: Git['Service']; readonly root: string; readonly fns: PreparedFns };

type Probed = { readonly text: string; readonly paths: readonly string[] };

const decoded = new TextDecoder();

export const neededPaths = Effect.fn('prepared.needed')(function* (
  place: NeedPlace,
  base: string | null,
  roots: readonly string[],
  carried: ReadonlySet<string>,
  capture: number,
) {
  const { git, root, fns } = place;
  const files = yield* FileSystem.FileSystem;
  const probes = new Map<string, Probed>();
  for (const path of roots) {
    const probe = yield* Effect.result(fns.walks.dependencyImports({ root, path, capture }));
    if (probe._tag === 'Failure') {
      yield* Effect.logDebug('a carried file adds no needed files: its imports could not be read', { path, reason: probe.failure.reason });
      continue;
    }
    if (probe.success.text !== undefined) probes.set(path, { text: probe.success.text, paths: probe.success.paths });
  }
  const statused = new Set<string>(carried);
  const foreign = new Set<string>();
  const classify = Effect.fnUntraced(function* (paths: readonly string[]) {
    const fresh = unique(paths).filter((path) => !statused.has(path));
    for (const path of fresh) statused.add(path);
    if (fresh.length === 0) return;
    for (const path of yield* changedAmong(place, fns, fresh)) foreign.add(path);
  });
  yield* classify([...probes.values()].flatMap((one) => one.paths));
  if (foreign.size === 0) return [];
  const heads = new Map<string, string | null>();
  const headOf = Effect.fnUntraced(function* (paths: readonly string[]) {
    const fresh = unique(paths).filter((path) => !heads.has(path));
    if (fresh.length > 0 && base !== null) {
      const read = yield* Effect.result(workingFilesAt(configuredGit(git, 'submit-dependency-base'), root, base, fresh, { capture }));
      for (const [at, path] of fresh.entries()) {
        const one = read._tag === 'Success' ? read.success[at] : undefined;
        if (one?._tag === 'Success') heads.set(path, one.success === null ? null : decoded.decode(one.success));
      }
    } else for (const path of fresh) heads.set(path, null);
  });
  const facts = new Map<string, BoundTexts>();
  const workings = new Map<string, string>();
  const edges = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const waiting = new Map<string, ImportedUse[]>();
  const required = new Set<string>();
  const rootUses = new Map<string, ReadonlySet<string>>();
  const rootLines = new Map<string, readonly number[] | undefined>();
  const link = (from: string, to: readonly string[]): void => {
    const targets = edges.get(from) ?? new Set<string>();
    for (const path of to) targets.add(path);
    edges.set(from, targets);
  };
  const enqueue = (uses: readonly ImportedUse[]): void => {
    for (const use of uses) {
      if (!foreign.has(use.path)) continue;
      const key = `${use.path}\0${use.name}\0${use.meaning}`;
      if (visited.has(key)) continue;
      visited.add(key);
      waiting.set(use.path, [...(waiting.get(use.path) ?? []), use]);
    }
  };
  const walking = [...probes].filter(([, one]) => one.paths.some((path) => foreign.has(path)));
  yield* headOf(walking.map(([path]) => path));
  for (const [path, probe] of walking) {
    const answer = yield* Effect.result(
      fns.walks.dependencies({ root, path, working: probe.text, head: heads.get(path) ?? null, lands: true }),
    );
    if (answer._tag === 'Failure' || answer.success.facts === undefined) continue;
    rootUses.set(path, new Set(answer.success.facts.landed.uses));
    rootLines.set(path, answer.success.lines);
    workings.set(path, probe.text);
    const targets = probe.paths.filter((one) => foreign.has(one));
    link(path, [...answer.success.imports.map((one) => one.path), ...targets]);
    yield* classify(answer.success.imports.map((one) => one.path));
    enqueue([...answer.success.imports, ...targets.map((one) => ({ path: one, name: '*', meaning: 'all' as const }))]);
  }
  while (waiting.size > 0) {
    const batch = [...waiting];
    waiting.clear();
    yield* headOf(batch.map(([path]) => path));
    for (const [path, uses] of batch) {
      let working = workings.get(path);
      if (working === undefined) {
        const read = yield* Effect.result(files.readFileString(join(root, path)));
        if (read._tag === 'Failure') {
          required.add(path);
          continue;
        }
        working = read.success;
        workings.set(path, working);
      }
      const answer = yield* Effect.result(
        fns.walks.dependencies({ root, path, working, head: heads.get(path) ?? null, lands: false, uses, facts: facts.get(path) }),
      );
      if (answer._tag === 'Failure') {
        required.add(path);
        continue;
      }
      if (answer.success.facts !== undefined) facts.set(path, answer.success.facts);
      if (answer.success.dependencies.length > 0) required.add(path);
      link(
        path,
        answer.success.imports.map((one) => one.path),
      );
      yield* classify(answer.success.imports.map((one) => one.path));
      enqueue(answer.success.imports);
    }
  }
  const reaches = new Map<string, ReadonlySet<string>>();
  const reached = (from: string): ReadonlySet<string> => {
    const kept = reaches.get(from);
    if (kept !== undefined) return kept;
    const paths = new Set<string>();
    const pending = [...(edges.get(from) ?? [])];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (paths.has(path) || !facts.has(path)) continue;
      paths.add(path);
      pending.push(...(edges.get(path) ?? []));
    }
    reaches.set(from, paths);
    return paths;
  };
  const users = new Map<string, string[]>();
  for (const [path, names] of rootUses) for (const name of names) users.set(name, [...(users.get(name) ?? []), path]);
  const matched: { readonly path: string; readonly name: string; readonly users: readonly string[] }[] = [];
  const asked = new Map<string, Set<string>>();
  for (const [path, one] of facts) {
    if (required.has(path)) continue;
    for (const candidate of one.candidates) {
      const using = (users.get(candidate.name) ?? []).filter((user) => reached(user).has(path));
      if (using.length === 0) continue;
      matched.push({ path, name: candidate.name, users: using });
      for (const user of using) asked.set(user, (asked.get(user) ?? new Set()).add(candidate.name));
    }
  }
  if (matched.length === 0) return [...required];
  const landing = [...heads].filter(([path]) => foreign.has(path));
  const placed = new Map<string, ReadonlySet<string> | null>();
  for (const [path, names] of asked) {
    const answer = yield* Effect.result(
      fns.walks.placements({
        root,
        path,
        text: workings.get(path)!,
        lines: rootLines.get(path),
        names: [...names],
        files: [...new Set([...(edges.get(path) ?? []), ...reached(path)])],
        texts: landing,
        capture,
      }),
    );
    placed.set(path, answer._tag === 'Success' ? new Set(answer.success) : null);
  }
  for (const one of matched) if (one.users.some((user) => placed.get(user)?.has(one.name) !== true)) required.add(one.path);
  return [...required];
});
