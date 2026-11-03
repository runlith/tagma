import { blobsAt } from '@runlith/git/entries';
import { Git } from '@runlith/git/Git';
import { textChanges } from '@runlith/utils/patch';
import { Effect } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import type { JudgedLine, LineHolders } from '../contract/wire/checks.js';
import type { RuleViolation } from '../contract/wire/enforcement.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { LinesUnread, PreparedHold, PreparedHolds, WorkingPathUnread } from '../../change-record/contract/service/prepared.js';
import { type Absent, siteRows } from '@tagma/inspection/verdict';

export type Found = RuleViolation & { readonly absent?: Absent };

export const wireOf = ({ absent: _absent, ...violation }: Found): RuleViolation => violation;

type Counted = {
  readonly violations: readonly Found[];
  readonly occurrences?: readonly Found[];
  readonly baseOccurrences?: readonly Found[];
};

type Touch = { readonly added: (line: number) => number | undefined; readonly removed: (line: number) => number | undefined };

const WHOLE = 0;

const EVERY: Touch = { added: () => WHOLE, removed: () => WHOLE };

export type Evidence = (files: readonly string[]) => Effect.Effect<ReadonlyMap<string, Touch>, InspectionFailed, Git>;

const hunkOf = (ranges: readonly { readonly start: number; readonly end: number }[]): ((line: number) => number | undefined) => {
  const hunks = new Map<number, number>();
  for (const [hunk, { start, end }] of ranges.entries()) for (let at = start; at < end; at += 1) hunks.set(at + 1, hunk);
  return (line) => hunks.get(line);
};

export const evidenceOf = (root: string, base: string, built: string): Evidence => {
  const read = new Map<string, Touch>();
  return Effect.fn('enforcement.excess.evidence')(function* (files: readonly string[]) {
    const missing = [...new Set(files)].filter((file) => !read.has(file));
    if (missing.length > 0) {
      const git = actingGit(yield* Git, 'inspection-files');
      const texts = yield* blobsAt(
        git,
        root,
        missing.flatMap((path) => [
          { tree: base, path },
          { tree: built, path },
        ]),
      ).pipe(
        Effect.mapError(
          (failure) =>
            new InspectionFailed({
              cause: 'git',
              reason: `git could not read the files a counted violation stands in: ${failure.message}`,
            }),
        ),
      );
      for (const [at, path] of missing.entries()) {
        const before = texts[at * 2];
        const after = texts[at * 2 + 1];
        if (before?.status !== 'text' || after?.status !== 'text') {
          read.set(path, EVERY);
          continue;
        }
        const changed = textChanges(before.text, after.text);
        read.set(
          path,
          changed.timedOut
            ? EVERY
            : { added: hunkOf(changed.changes.map((one) => one.after)), removed: hunkOf(changed.changes.map((one) => one.before)) },
        );
      }
    }
    return new Map(
      files.flatMap((file) => {
        const touch = read.get(file);
        return touch === undefined ? [] : [[file, touch] as const];
      }),
    );
  });
};

type Holding = { readonly holders: readonly string[]; readonly withheld?: string };

export type Attribution = Holding & { readonly violation: RuleViolation };

export type Judged = {
  readonly root: string;
  readonly base: string;
  readonly built: string;
  readonly holders?: LineHolders;
  readonly holds?: PreparedHolds;
};

const UNHELD: Holding = { holders: [] };

const placeOf = ({ file, line }: JudgedLine): string => `${file}:${line}`;

const grouped = (rows: readonly Found[]): ReadonlyMap<string, readonly Found[]> => {
  const groups = new Map<string, Found[]>();
  for (const one of rows) {
    const group = groups.get(one.fingerprint);
    if (group === undefined) groups.set(one.fingerprint, [one]);
    else group.push(one);
  }
  return groups;
};

const unattributed = (failure: LinesUnread): InspectionFailed => new InspectionFailed({ cause: 'source', reason: failure.reason });

const unheld = (failure: StoreFailure | WorkingPathUnread): InspectionFailed =>
  new InspectionFailed({
    cause: 'source',
    reason:
      failure._tag === 'WorkingPathUnread'
        ? `the working tree could not be read at ${failure.path}, so whether a violation stands only on it is unknown: ${failure.reason}`
        : `the change record could not say who wrote the paths a violation stands on: ${failure.message}`,
  });

const lineOf = (one: Found): JudgedLine | undefined => (one.line === undefined ? undefined : { file: one.file, line: one.line });

const linesOf = (rows: readonly Found[]): readonly JudgedLine[] => [
  ...new Map(
    rows.flatMap((one) => {
      const line = lineOf(one);
      return line === undefined ? [] : [[placeOf(line), line] as const];
    }),
  ).values(),
];

export const attributed = Effect.fn('enforcement.excess.attributed')(function* (subject: Judged, evidence: Evidence, units: Counted) {
  const verdict = {
    violations: siteRows(units.violations),
    occurrences: siteRows(units.occurrences ?? []),
    baseOccurrences: siteRows(units.baseOccurrences ?? []),
  };
  if (subject.holders === undefined) return verdict.violations.map((one): Attribution => ({ violation: wireOf(one), ...UNHELD }));
  const core = grouped(verdict.violations);
  const built = grouped(verdict.occurrences);
  const standing = grouped(verdict.baseOccurrences);
  const touched =
    built.size === 0
      ? new Map<string, Touch>()
      : yield* evidence([...verdict.occurrences, ...verdict.baseOccurrences].map((one) => one.file));
  const hunkKey = (one: Found, side: 'added' | 'removed'): string | undefined => {
    const hunk = one.line === undefined ? undefined : touched.get(one.file)?.[side](one.line);
    return hunk === undefined ? undefined : `${one.file}\0${hunk}`;
  };
  const chosen = new Map<string, readonly Found[]>();
  for (const [key, rows] of built) {
    const added = rows.filter((one) => one.line === undefined || hunkKey(one, 'added') !== undefined);
    const removed = new Map<string, number>();
    for (const one of standing.get(key) ?? []) {
      const hunk = hunkKey(one, 'removed');
      if (hunk !== undefined) removed.set(hunk, (removed.get(hunk) ?? 0) + 1);
    }
    const addedIn = new Map<string, number>();
    for (const one of added) {
      const hunk = hunkKey(one, 'added');
      if (hunk !== undefined) addedIn.set(hunk, (addedIn.get(hunk) ?? 0) + 1);
    }
    const fresh = added.filter((one) => {
      const hunk = hunkKey(one, 'added');
      return hunk === undefined || (addedIn.get(hunk) ?? 0) > (removed.get(hunk) ?? 0);
    });
    chosen.set(key, fresh.length > 0 ? fresh : added.length > 0 ? added : (core.get(key) ?? []));
  }
  const violations = [...verdict.violations.filter((one) => !chosen.has(one.fingerprint)), ...[...chosen.values()].flat()];
  const asked = linesOf(violations);
  const held = asked.length === 0 ? [] : yield* Effect.mapError(subject.holders(asked), unattributed);
  const byLine = new Map(asked.map((line, at) => [placeOf(line), held[at] ?? []] as const));
  const absent = [...new Set(violations.flatMap((one) => one.absent ?? []))];
  const answered = subject.holds === undefined || absent.length === 0 ? [] : yield* Effect.mapError(subject.holds(absent), unheld);
  const holds = new Map<string, PreparedHold | undefined>(absent.map((path, at) => [path, answered[at]]));
  const holdingOf = (one: Found): Holding => {
    const line = lineOf(one);
    const writers = line === undefined ? [] : (byLine.get(placeOf(line)) ?? []);
    const stands = (one.absent ?? []).filter((path) => holds.get(path)?._tag === 'stands');
    const [only] = stands;
    const hold = only === undefined ? undefined : holds.get(only);
    if (stands.length !== 1 || hold?._tag !== 'stands') return { holders: writers };
    return { holders: [...new Set([...writers, ...hold.writers])], withheld: only };
  };
  return violations.map((one): Attribution => ({ violation: wireOf(one), ...holdingOf(one) }));
});
