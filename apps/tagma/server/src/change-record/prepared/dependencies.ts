import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { workingFilesAt } from '@runlith/git/working';
import { configuredGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { PreparedRow } from '../contract/service/prepared.js';
import type { Judged } from '../contract/service/holdings.js';
import type { Mark } from '../lines/marks.js';
import type { SelectedSpan } from '../lines/selection.js';
import { walkCut } from '../lines/walks.js';
import type { BoundTexts, Dependency, DependencyInput, ImportedUse, PeerLine } from './dependencyWalk.js';
import type { Landing, Planned } from './tree.js';
import { bearsNobody } from './carriers.js';

export type DependencyRoot = {
  readonly path: string;
  readonly working: string;
  readonly selected: string;
  readonly positions: readonly SelectedSpan[];
  readonly lines: readonly number[];
  readonly judged: Judged;
};

const leftOut = (mark: Mark, carriers: ReadonlySet<string>, nobody: boolean): PeerLine['holder'] | undefined =>
  mark === 'external' ? (nobody ? undefined : null) : carriers.has(mark.holder) ? undefined : mark.holder;

const peersOf = (judged: Judged, carriers: ReadonlySet<string>, nobody: boolean): readonly PeerLine[] => {
  if (judged.verdict.verdict !== 'proven' || judged.verdict.lines === 'unweighed') return [];
  const peers: PeerLine[] = [];
  for (const line of judged.verdict.regions.flatMap((region) => region.lines)) {
    const holder = line.kind === 'added' ? leftOut(line.mark, carriers, nobody) : undefined;
    if (holder !== undefined) peers.push({ line: line.at, holder });
  }
  const existence = judged.verdict.existence;
  const creator = existence === null ? undefined : leftOut(existence, carriers, nobody);
  if (creator !== undefined) peers.push({ line: 0, holder: creator });
  return peers;
};

const unproven = (path: string, reason: string) =>
  new GateRefusal('walk-cut', `dependencies of ${path} cannot be read: ${reason}`, [
    `include ${path} in paths and carry it as it stands (whole: ${JSON.stringify([path])})`,
    'wait for its holders to land their lines, then submit again',
  ]);

export const checkDependencies = Effect.fn('prepared.dependencies')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  base: string | null,
  plan: readonly Planned<Row>[],
  roots: readonly DependencyRoot[],
  capture: number,
) {
  const { root, carriers, fns } = landing;
  const planned = new Map(plan.map((one) => [one.path, one]));
  const borne = (path: string, digest?: string | null): boolean => {
    const one = planned.get(path);
    const current = digest === undefined ? (one?.land === 'own' ? one.landed?.working : undefined) : digest;
    return bearsNobody(landing.origin, landing.explicit, landing.team, path, current);
  };
  const foreign = yield* fns.foreignPaths(landing, carriers, (path) => planned.get(path)?.land !== 'whole' && !borne(path));
  if (foreign.size === 0) return;
  const files = yield* FileSystem.FileSystem;
  const snapshots = new Map<string, DependencyInput>();
  const facts = new Map<string, BoundTexts>();
  const needed = new Map<string, ImportedUse[]>();
  const ignored = new Set<string>();
  const visited = new Set<string>();
  const dependencies: Dependency[] = [];
  const rootUses = new Map<string, ReadonlySet<string>>();
  const edges = new Map<string, Set<string>>();
  const enqueue = (uses: readonly ImportedUse[]): void => {
    for (const use of uses) {
      if (!foreign.has(use.path)) continue;
      const key = `${use.path}\0${use.name}\0${use.meaning}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const held = needed.get(use.path) ?? [];
      held.push(use);
      needed.set(use.path, held);
    }
  };
  const inspect = Effect.fnUntraced(function* (input: DependencyInput) {
    const answer = yield* Effect.mapError(fns.walks.dependencies({ ...input, facts: facts.get(input.path) }), (failure) =>
      walkCut(input.path, failure, `include ${input.path} in paths and whole to carry its complete text`),
    );
    if (answer.facts !== undefined) {
      facts.set(input.path, answer.facts);
      if (input.uses === undefined) rootUses.set(input.path, new Set(answer.facts.selected.uses));
    }
    const targets = edges.get(input.path) ?? new Set<string>();
    for (const imported of answer.imports) targets.add(imported.path);
    edges.set(input.path, targets);
    dependencies.push(...answer.dependencies);
    enqueue(answer.imports);
  });
  for (const one of roots) {
    const peers = peersOf(one.judged, carriers, borne(one.path, one.judged.digests?.working));
    if (peers.length === 0) continue;
    const input = { root, path: one.path, working: one.working, selected: one.selected, peers, positions: one.positions, lines: one.lines };
    snapshots.set(one.path, input);
    yield* inspect(input);
  }
  for (const one of plan) {
    if (snapshots.has(one.path)) continue;
    const probe = yield* fns.walks
      .dependencyImports({ root, path: one.path, text: one.land === 'own' ? one.text : undefined, capture })
      .pipe(Effect.mapError((failure) => walkCut(one.path, failure, `land without ${one.path}, or wait for the foreign changes to land`)));
    if (probe.text === undefined || !probe.paths.some((path) => foreign.has(path))) continue;
    const input = {
      root,
      path: one.path,
      working: one.land === 'own' ? one.working : probe.text,
      selected: probe.text,
      peers: [],
      positions: one.land === 'own' ? one.positions : undefined,
      lines: one.land === 'own' ? one.lines : undefined,
    };
    snapshots.set(one.path, input);
    yield* inspect(input);
    const targets = edges.get(one.path) ?? new Set<string>();
    for (const path of probe.paths) if (foreign.has(path)) targets.add(path);
    edges.set(one.path, targets);
    enqueue([...targets].map((path) => ({ path, name: '*', meaning: 'all' as const })));
  }
  while (needed.size > 0) {
    const batch = [...needed];
    needed.clear();
    const unseen = batch.map(([path]) => path).filter((path) => !snapshots.has(path) && !ignored.has(path));
    const judged = unseen.length === 0 ? new Map<string, Judged>() : yield* fns.judged(landing, unseen);
    const dirty = unseen.filter((path) => {
      const one = judged.get(path);
      return one !== undefined && peersOf(one, carriers, borne(path, one.digests?.working)).length > 0;
    });
    const basePaths = dirty.filter((path) => !planned.has(path));
    const older =
      base === null || basePaths.length === 0
        ? []
        : yield* workingFilesAt(configuredGit(landing.git, 'submit-dependency-base'), root, base, basePaths, { capture });
    const texts = new Map(basePaths.map((path, index) => [path, base === null ? null : older[index]]));
    for (const [path, uses] of batch) {
      if (ignored.has(path)) continue;
      let input = snapshots.get(path);
      if (input === undefined) {
        const one = judged.get(path);
        if (one === undefined) {
          ignored.add(path);
          continue;
        }
        if (one.verdict.verdict !== 'proven') {
          if (one.verdict.writers.some((writer) => !carriers.has(writer.holder)))
            return yield* unproven(path, 'its holders are not proven');
          continue;
        }
        if (one.verdict.lines === 'unweighed' && one.verdict.hands.some((hand) => !carriers.has(hand.holder)))
          return yield* unproven(path, 'its peer changes are not weighed by lines');
        const peers = peersOf(one, carriers, borne(path, one.digests?.working));
        if (peers.length === 0) {
          ignored.add(path);
          continue;
        }
        const working = yield* files.readFileString(join(root, path)).pipe(Effect.mapError((failure) => unproven(path, failure.message)));
        const content = yield* fns.walks.content(working).pipe(Effect.mapError((failure) => walkCut(path, failure)));
        if (one.digests === null || content.digest !== one.digests.working)
          return yield* unproven(path, 'the file changed after its judgement');
        const carried = planned.get(path);
        const from = texts.get(path);
        if (carried === undefined && from !== null && (from === undefined || from._tag === 'Failure'))
          return yield* unproven(path, 'its HEAD text is unread');
        let selected: string | null;
        if (carried?.land === 'own') selected = carried.text;
        else if (carried?.land === 'whole') selected = working;
        else if (from === null) selected = null;
        else {
          if (from === undefined || from._tag === 'Failure') return yield* unproven(path, 'its HEAD text is unread');
          selected = from.success === null ? null : new TextDecoder().decode(from.success);
        }
        input = { root, path, working, selected, peers, positions: carried?.land === 'own' ? carried.positions : undefined };
        snapshots.set(path, input);
      }
      yield* inspect({ ...input, uses });
    }
  }
  const users = new Map<string, Set<string>>();
  for (const [path, names] of rootUses)
    for (const name of names) {
      const roots = users.get(name) ?? new Set<string>();
      roots.add(path);
      users.set(name, roots);
    }
  const reaches = new Map<string, ReadonlySet<string>>();
  const reached = (root: string): ReadonlySet<string> => {
    const kept = reaches.get(root);
    if (kept !== undefined) return kept;
    const paths = new Set<string>();
    const pending = [...(edges.get(root) ?? [])];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (paths.has(path) || !facts.has(path)) continue;
      paths.add(path);
      pending.push(...(edges.get(path) ?? []));
    }
    reaches.set(root, paths);
    return paths;
  };
  const matched: { readonly candidate: Dependency; readonly users: readonly string[] }[] = [];
  const asked = new Map<string, Set<string>>();
  for (const [path, one] of facts)
    for (const candidate of one.candidates) {
      const using = [...(users.get(candidate.name) ?? [])].filter((user) => reached(user).has(path));
      if (using.length === 0) continue;
      matched.push({ candidate, users: using });
      for (const user of using) asked.set(user, (asked.get(user) ?? new Set()).add(candidate.name));
    }
  const landed = (path: string): string | null | undefined => {
    const snapshot = snapshots.get(path);
    if (snapshot !== undefined) return snapshot.selected;
    const carried = planned.get(path);
    return carried?.land === 'own' ? carried.text : undefined;
  };
  const placed = new Map<string, ReadonlySet<string>>();
  for (const [path, names] of asked) {
    const input = snapshots.get(path);
    if (input === undefined || input.selected === null) continue;
    const files = [...new Set([...(edges.get(path) ?? []), ...reached(path)])];
    const answer = yield* fns.walks
      .placements({
        root,
        path,
        text: input.selected,
        lines: input.lines,
        names: [...names],
        files,
        texts: files.flatMap((file) => {
          const text = landed(file);
          return text === undefined ? [] : [[file, text] as const];
        }),
        capture,
      })
      .pipe(Effect.mapError((failure) => walkCut(path, failure, `include ${path} in paths and whole to carry its complete text`)));
    placed.set(path, new Set(answer));
  }
  for (const { candidate, users: using } of matched)
    if (using.some((user) => placed.get(user)?.has(candidate.name) !== true)) dependencies.push(candidate);
  if (dependencies.length === 0) return;
  const unique = [...new Map(dependencies.map((one) => [`${one.path}:${one.line}:${one.name}:${one.holder}`, one])).values()];
  const paths = [...new Set(unique.map((one) => one.path))];
  const holders = [...new Set(unique.flatMap((one) => (one.holder === null ? [] : [one.holder])))];
  const whole = `include ${paths.join(', ')} in paths and carry them as they stand (whole: ${JSON.stringify(paths)})`;
  return yield* new GateRefusal(
    'lines-held',
    `selected references require uncommitted declarations: ${unique.map((one) => `${one.name} in ${one.path}:${one.line}, held by ${one.holder ?? 'nobody'}`).join('; ')}`,
    holders.length === 0
      ? [whole]
      : [
          'wait for the named holders to land their declarations, then submit again',
          `carry their lines with taking: ${JSON.stringify(holders)}; include their paths if paths narrows this landing`,
          whole,
        ],
  );
});
