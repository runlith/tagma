import { newViolations } from '@tagma/inspection/verdict';
import { Git } from '@runlith/git/Git';
import { ancestorAt, commitsAt } from '@runlith/git/history';
import { type CommitPair, diffCommitsAt, diffTreeAt, type TreeDifference } from '@runlith/git/trees';
import { canonicalJson } from '@runlith/utils/object';
import { Effect } from 'effect';
import { Configs } from '../../config/contract/service/configs.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { actingGit, runGit } from '../../platform/git/ownGit.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { type Check, type CountedDebt, checkOf, isProgrammed, isUnrun } from '../contract/wire/document.js';
import type { Escape } from '../../graph/contract/wire/enforcement.js';
import {
  type Measurement,
  type RuleViolation,
  inspectionBase,
  inspectionFileLocal,
  inspectionHides,
} from '../contract/wire/enforcement.js';
import { judgedDebt } from '../rules/held.js';
import { type Measured, measureReach } from '../rules/measure.js';
import { measureBound } from '../rules/measureBound.js';
import { declarationOf, measuredAs } from '../rules/measurements.js';
import { covers, moduleMapOf } from '../rules/reach.js';
import { Inspections } from '../workers/inspectionLanes.js';
import { gitUnread } from '../workers/unread.js';
import type { Ruled } from './rule.js';

const DIFFS_AT_ONCE = 8;

type OriginSearch = {
  readonly projectId: number;
  readonly ruled: Ruled;
  readonly measured: Measured;
  readonly commonDir: string | undefined;
  readonly previous: Measurement | undefined;
  readonly debt: readonly CountedDebt[];
  readonly violations: readonly RuleViolation[];
};

type OriginReading = {
  readonly check: Check;
  readonly measured?: Measured;
  readonly outside: ReadonlySet<string>;
  readonly unjudged: ReadonlySet<string>;
};

export type Origin = { readonly commit: string; readonly changed?: Escape['changed'] };

const NONE: ReadonlySet<string> = new Set();

const unproved = (reason: string) =>
  new GateRefusal('inspection-failed', `escape origin could not be established: ${reason}`, [
    'restore the readable git history and inspection of the named version, then remeasure the rule',
  ]);

export const escapeOrigins = Effect.fn('enforcement.escapeOrigins')(function* (search: OriginSearch) {
  const origins = new Map<string, Origin>();
  if (search.violations.length === 0) return origins;
  const { projectId, ruled, measured, previous, debt } = search;
  const { root, head } = measured;
  const git = actingGit(yield* Git, 'enforcement-origin');
  const configs = yield* Configs;
  const project = yield* (yield* Projects).byId(projectId);
  const map = yield* moduleMapOf(projectId);
  const pending = new Set(search.violations.map((one) => one.fingerprint));
  const known = new Map<string, OriginReading>();
  const localProgram = measured.coverage !== undefined && measured.coverage.every((one) => one.paths !== null);
  const outsideOf = (reading: Measured) =>
    new Set(newViolations(reading.verdict.violations, [], judgedDebt(debt)).violations.map((one) => one.fingerprint));
  const unjudgedOf = (reading: Measured) => new Set(reading.verdict.unjudged.map((one) => one.file));
  const filesOf = new Map<string, Set<string>>();
  for (const one of search.violations) filesOf.set(one.fingerprint, (filesOf.get(one.fingerprint) ?? new Set<string>()).add(one.file));
  const hiddenIn = (reading: OriginReading, fingerprint: string): string | undefined => {
    if (reading.unjudged.size === 0) return undefined;
    const { check } = reading;
    const hides = isUnrun(check) || isProgrammed(check) ? 'any' : inspectionHides(check);
    if (hides === 'nothing') return undefined;
    if (hides === 'any') return [...reading.unjudged][0];
    return [...(filesOf.get(fingerprint) ?? [])].find((file) => reading.unjudged.has(file));
  };
  const places = yield* ruled.reach(inspectionBase(ruled.document.check));
  known.set(head, { check: ruled.document.check, measured, outside: outsideOf(measured), unjudged: unjudgedOf(measured) });
  let ahead: readonly CommitPair[] = [];
  const read = new Map<string, readonly TreeDifference[]>();
  const changedAt = Effect.fnUntraced(function* (parent: string, commit: string) {
    const held = read.get(commit);
    if (held !== undefined) {
      read.delete(commit);
      return held;
    }
    read.clear();
    const from = ahead.findIndex((pair) => pair.to === commit && pair.from === parent);
    const window = from === -1 ? [] : ahead.slice(from, from + DIFFS_AT_ONCE);
    const alone = diffTreeAt(git, root, parent, commit).pipe(Effect.mapError(gitUnread));
    if (window.length < 2) return yield* alone;
    return yield* diffCommitsAt(git, root, window).pipe(
      Effect.map((diffs) => {
        for (const [at, pair] of window.entries()) if (at > 0) read.set(pair.to, diffs[at] ?? []);
        return diffs[0] ?? [];
      }),
      Effect.catch(() => alone),
    );
  });
  const readingAt = Effect.fn('enforcement.originReading')(function* (commit: string, parent?: string) {
    const cached = known.get(commit);
    if (cached !== undefined) return cached;
    const config = yield* configs.read({ projectId, root, tree: commit, actor: { _tag: 'Operator' }, commonDir: search.commonDir });
    const check = checkOf(ruled.document.inspection, { config }, map);
    if (isUnrun(check)) {
      if (check.undeclared === true) return { check, outside: NONE, unjudged: NONE } satisfies OriginReading;
      return yield* unproved(`${commit}: ${check.unrun}`);
    }
    const places = yield* ruled.reach(inspectionBase(check));
    const before = parent === undefined ? undefined : known.get(parent);
    const local = !isProgrammed(check) && inspectionFileLocal(check);
    const targets = [...new Set(search.violations.filter((one) => pending.has(one.fingerprint)).map((one) => one.file))].filter(
      covers(places),
    );
    if (before?.measured !== undefined && canonicalJson(before.check) === canonicalJson(check)) {
      const changed = yield* changedAt(parent!, commit);
      const inputs = new Set([...(before.measured.read ?? []), ...(before.measured.footprint?.files ?? [])]);
      const touched = isProgrammed(check)
        ? changed.length > 0
        : local
          ? changed.some((one) => targets.includes(one.path))
          : changed.some((one) => covers(places)(one.path) || inputs.has(one.path) || one.path.endsWith('package.json'));
      if (!touched) return before;
    }
    const selected =
      local || (isProgrammed(check) && localProgram && canonicalJson(check) === canonicalJson(ruled.document.check)) ? targets : undefined;
    const reading = isProgrammed(check)
      ? yield* measureBound(projectId, root, commit, ruled.name, check, places, { _tag: 'Operator' }, selected, 'background')
      : yield* measureReach(project, check, places, { root, head: commit }, 'background', undefined, selected);
    return { check, measured: reading, outside: outsideOf(reading), unjudged: unjudgedOf(reading) } satisfies OriginReading;
  });
  let boundary: string | undefined;
  if (previous !== undefined) {
    const existing = yield* commitsAt(git, root, [previous.commit]).pipe(Effect.mapError(gitUnread));
    if (existing.has(previous.commit) && (yield* ancestorAt(git, root, previous.commit, head).pipe(Effect.mapError(gitUnread))))
      boundary = previous.commit;
  }
  if (
    boundary !== undefined &&
    !measuredAs(previous, {
      tree: previous?.identity?.tree ?? '',
      declaration: declarationOf(ruled.document, places),
      implementation: (yield* Inspections).code,
    })
  ) {
    const reading = yield* readingAt(boundary);
    known.set(boundary, reading);
    for (const fingerprint of pending)
      if (reading.outside.has(fingerprint)) {
        origins.set(fingerprint, { commit: boundary, changed: 'check' });
        pending.delete(fingerprint);
      }
    if (pending.size === 0) return origins;
  }
  if (boundary === undefined) {
    const shallow = yield* runGit(yield* Git, 'enforcement-origin', ['-C', root, 'rev-parse', '--is-shallow-repository']);
    if (shallow === 'true') return yield* unproved(`${root} has shallow history and no confirmed absent boundary`);
  }
  return yield* (yield* Inspections)
    .history({ root, head, after: boundary }, (next) =>
      Effect.gen(function* () {
        for (;;) {
          const page = yield* next;
          ahead = page.entries.flatMap((one) => (one.parent === undefined ? [] : [{ from: one.parent, to: one.commit }]));
          read.clear();
          const carried = yield* configs.carried({ root, commits: page.entries.map((one) => one.commit) });
          for (const one of page.entries) {
            if (carried.has(one.commit)) {
              const reading = yield* readingAt(one.commit, one.parent);
              known.set(one.commit, reading);
              for (const fingerprint of pending) {
                if (reading.outside.has(fingerprint)) {
                  origins.set(fingerprint, { commit: one.commit });
                  pending.delete(fingerprint);
                  continue;
                }
                const hidden = hiddenIn(reading, fingerprint);
                if (hidden !== undefined)
                  return yield* unproved(`${one.commit}: the inspection left ${hidden} unjudged, where ${fingerprint} may stand`);
              }
              if (pending.size === 0) return origins;
            }
            for (const commit of one.forget) known.delete(commit);
          }
          if (page.done) return yield* unproved(`no historical version establishes ${[...pending].join(', ')} at ${head}`);
        }
      }),
    )
    .pipe(Effect.catchTag('InspectionFailed', (failure) => Effect.fail(unproved(failure.reason))));
});
