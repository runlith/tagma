import { siteRows, type Unjudged } from '@tagma/inspection/verdict';
import type { Git } from '@runlith/git/Git';
import { Effect, Result } from 'effect';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import type { TreeSubject } from '../contract/wire/checks.js';
import type { CountedDebt } from '../contract/wire/document.js';
import { type BindingSubject, type BoundRule, judgeBindings } from '../programs/bindings.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import { type Evidence, evidenceOf, type Found } from './excess.js';
import { pathsOf } from './trees.js';

export type Reading = {
  readonly verdict: {
    readonly violations: readonly Found[];
    readonly unjudged: readonly Unjudged[];
    readonly occurrences?: readonly Found[];
    readonly baseOccurrences?: readonly Found[];
  };
};

type BoundReadings = Effect.Success<ReturnType<typeof judgeBindings>>;

type Base = {
  readonly base: string;
  readonly debt?: true;
};

type Side = Base & {
  readonly paths: readonly string[];
  readonly evidence: Evidence;
};

type Comparison = {
  readonly reading: Reading;
  readonly evidence: Evidence;
  readonly allowance?: ReadonlyMap<string, number>;
};

export type Merging = Result.Result<readonly Side[], OwnGitFailed>;

export type Bound = {
  readonly own: BoundReadings;
  readonly sides: readonly BoundReadings[];
  readonly ms: ReadonlyMap<string, number>;
};

const NO_READINGS: BoundReadings = new Map();

export const UNBOUND: Bound = { own: NO_READINGS, sides: [], ms: new Map() };

const boundReadings = (own: BoundReadings, sides: readonly BoundReadings[]): Bound => {
  const ms = new Map<string, number>();
  for (const readings of [own, ...sides]) {
    for (const [rule, run] of readings) ms.set(rule, (ms.get(rule) ?? 0) + run.ms);
  }
  return { own, sides, ms };
};

const NOT_MERGING: Merging = Result.succeed([]);

const UNTOUCHED: Reading = { verdict: { violations: [], unjudged: [] } };

const sidesRead = Effect.fn('enforcement.merged.sides')(function* (subject: TreeSubject, merged: readonly Base[]) {
  return yield* Effect.result(
    Effect.forEach(merged, ({ base, debt }) =>
      Effect.map(pathsOf({ projectId: subject.projectId, root: subject.root, base, built: subject.built }), (tree): Side => ({
        base,
        debt,
        paths: tree.paths,
        evidence: evidenceOf(subject.root, base, subject.built),
      })),
    ),
  );
});

export const mergingOf = (subject: TreeSubject, hasDebt: boolean) => {
  const merged: Base[] = (subject.merged ?? []).map((base) => ({ base }));
  if (hasDebt && subject.debtBase !== undefined && !merged.some((side) => side.base === subject.debtBase))
    merged.push({ base: subject.debtBase, debt: true });
  return merged.length === 0 ? Effect.succeed(NOT_MERGING) : sidesRead(subject, merged);
};

export const boundOf = Effect.fn('enforcement.merged.bound')(function* (
  binding: BindingSubject,
  rules: readonly BoundRule[],
  merging: Merging,
) {
  const inherited = Result.isSuccess(merging) && merging.success.some((side) => side.debt === true);
  const own = yield* judgeBindings(binding, inherited ? rules.map((rule) => ({ ...rule, debt: [] })) : rules);
  if (Result.isFailure(merging)) return { merging, bound: boundReadings(own, []) };
  const sides = yield* Effect.result(
    Effect.forEach(merging.success, (side) =>
      side.paths.length === 0
        ? Effect.succeed(NO_READINGS)
        : judgeBindings(
            { ...binding, base: side.base, paths: side.paths },
            side.debt === true ? rules.filter((rule) => rule.debt.length > 0).map((rule) => ({ ...rule, debt: [] })) : rules,
          ),
    ),
  );
  return Result.isFailure(sides)
    ? { merging: Result.fail(sides.failure), bound: boundReadings(own, []) }
    : { merging, bound: boundReadings(own, sides.success) };
});

const looseOf = (one: Unjudged): string => `${one.file}\0${one.line}\0${one.specifier}`;

const tally = (rows: readonly Found[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const { fingerprint } of rows) counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  return counts;
};

const grouped = (rows: readonly Found[]): ReadonlyMap<string, readonly Found[]> => {
  const groups = new Map<string, Found[]>();
  for (const one of rows) {
    const group = groups.get(one.fingerprint);
    if (group === undefined) groups.set(one.fingerprint, [one]);
    else group.push(one);
  }
  return groups;
};

const beyondSides = Effect.fnUntraced(function* (own: Comparison, sides: readonly Comparison[]) {
  const fresh = [own, ...sides].map((side) => ({ ...side, counts: tally(side.reading.verdict.violations) }));
  const occurring = grouped(own.reading.verdict.occurrences ?? []);
  const kept: Found[] = [];
  for (const [fingerprint, rows] of grouped(own.reading.verdict.violations)) {
    const whole = occurring.get(fingerprint) ?? rows;
    const compared = fresh.filter((side) => side.allowance === undefined || side.allowance.has(fingerprint));
    const counts = compared.map(({ counts, allowance }) => {
      const count = counts.get(fingerprint) ?? 0;
      return allowance === undefined ? count : Math.max(count, whole.length - (allowance.get(fingerprint) ?? 0));
    });
    const room = Math.min(...counts);
    if (room === 0) continue;
    const excused = counts.map((count) => Math.max(0, whole.length - count));
    if (excused.every((count) => count === 0)) {
      kept.push(...rows.slice(0, room));
      continue;
    }
    const files = [...new Set(whole.map((one) => one.file))];
    const standing = new Set<Found>();
    for (const [at, side] of compared.entries()) {
      let left = excused[at] ?? 0;
      if (left === 0) continue;
      const touched = yield* side.evidence(files);
      for (const one of whole) {
        if (left === 0) break;
        if (
          standing.has(one) ||
          !siteRows([one]).some((site) => site.line !== undefined && touched.get(site.file)?.added(site.line) === false)
        )
          continue;
        standing.add(one);
        left -= 1;
      }
    }
    kept.push(...whole.filter((one) => !standing.has(one)).slice(0, room));
  }
  const loose = sides.filter((side) => side.allowance === undefined).map((side) => new Set(side.reading.verdict.unjudged.map(looseOf)));
  return {
    verdict: {
      violations: kept,
      unjudged: own.reading.verdict.unjudged.filter((one) => loose.every((set) => set.has(looseOf(one)))),
    },
  } satisfies Reading;
});

export type Asked = (
  base: string,
  changed: readonly string[],
  readings: BoundReadings,
  debt: readonly CountedDebt[],
) => Effect.Effect<Reading, InspectionFailed>;

export type Own = { readonly base: string; readonly paths: readonly string[]; readonly evidence: Evidence };

export const againstParents = (
  merging: Merging,
  own: Own,
  bound: Bound,
  ask: Asked,
  touched: (changed: readonly string[]) => readonly string[],
  debt: readonly CountedDebt[] = [],
): Effect.Effect<Reading, InspectionFailed, Git> => {
  if (Result.isFailure(merging))
    return Effect.fail(
      new InspectionFailed({
        cause: 'git',
        reason: `git could not read what this merge changes against its other parents: ${merging.failure.message}`,
      }),
    );
  const sides = merging.success.map((side, at) => ({ side, at })).filter(({ side }) => side.debt !== true || debt.length > 0);
  const inherited = merging.success.some((side) => side.debt === true);
  const mine = ask(own.base, own.paths, bound.own, inherited ? [] : debt);
  if (sides.length === 0) return mine;
  const allowance = new Map(debt.map((entry) => [entry.fingerprint, entry.count ?? 1]));
  const theirs = sides.map(({ side, at }) => {
    const paths = touched(side.paths);
    const reading =
      paths.length === 0
        ? Effect.succeed(UNTOUCHED)
        : ask(side.base, paths, bound.sides[at] ?? NO_READINGS, side.debt === true ? [] : debt);
    return Effect.map(reading, (reading): Comparison => ({
      reading,
      evidence: side.evidence,
      allowance: side.debt === true ? allowance : undefined,
    }));
  });
  return Effect.flatMap(
    Effect.all([Effect.map(mine, (reading): Comparison => ({ reading, evidence: own.evidence })), ...theirs]),
    ([reading, ...others]) => beyondSides(reading, others),
  );
};
