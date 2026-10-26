import { blobsAt } from '@runlith/git/entries';
import { Git } from '@runlith/git/Git';
import { textChanges } from '@runlith/utils/patch';
import { Effect } from 'effect';
import { actingGit } from '../../platform/git/ownGit.js';
import type { JudgedLine, LineHolders, LineRemovers } from '../contract/wire/checks.js';
import type { RuleViolation } from '../contract/wire/enforcement.js';
import { InspectionFailed } from '../workers/inspectionLanes.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { PreparedHold, PreparedHolds, WorkingPathUnread } from '../../change-record/contract/service/prepared.js';
import { type Absent, siteRows } from '@tagma/inspection/verdict';

export type Found = RuleViolation & { readonly absent?: Absent };

export const wireOf = ({ absent: _absent, ...violation }: Found): RuleViolation => violation;

type Counted = {
  readonly violations: readonly Found[];
  readonly occurrences?: readonly Found[];
  readonly baseOccurrences?: readonly Found[];
};

type Touch = { readonly added: (line: number) => boolean; readonly removed: (line: number) => boolean };

const EVERY: Touch = { added: () => true, removed: () => true };

export type Evidence = (files: readonly string[]) => Effect.Effect<ReadonlyMap<string, Touch>, InspectionFailed, Git>;

const spanned = (ranges: readonly { readonly start: number; readonly end: number }[]): ((line: number) => boolean) => {
  const lines = new Set<number>();
  for (const { start, end } of ranges) for (let at = start; at < end; at += 1) lines.add(at + 1);
  return (line) => lines.has(line);
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
            : { added: spanned(changed.changes.map((one) => one.after)), removed: spanned(changed.changes.map((one) => one.before)) },
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
  readonly removers?: LineRemovers;
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

const cutShort = (refused: GateRefusal<'walk-cut'>): InspectionFailed =>
  new InspectionFailed({ cause: 'deadline', reason: refused.reason });

const unheld = (failure: StoreFailure | WorkingPathUnread | GateRefusal<'walk-cut'>): InspectionFailed =>
  new InspectionFailed({
    cause: 'source',
    reason:
      failure._tag === 'WorkingPathUnread'
        ? `the working tree could not be read at ${failure.path}, so whether a violation stands only on it is unknown: ${failure.reason}`
        : `the change record could not say who holds the paths a violation stands on: ${failure.message}`,
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
  const built = grouped(verdict.occurrences ?? []);
  const standing = grouped(verdict.baseOccurrences ?? []);
  const touched =
    built.size === 0
      ? new Map<string, Touch>()
      : yield* evidence([...(verdict.occurrences ?? []), ...(verdict.baseOccurrences ?? [])].map((one) => one.file));
  const added = new Map<string, readonly Found[]>();
  const removed = new Map<string, readonly Found[]>();
  for (const [key, rows] of built)
    added.set(
      key,
      rows.filter((one) => one.line === undefined || touched.get(one.file)?.added(one.line) === true),
    );
  for (const key of built.keys())
    removed.set(
      key,
      (standing.get(key) ?? []).filter((one) => one.line !== undefined && touched.get(one.file)?.removed(one.line) === true),
    );
  const judged = [...verdict.violations, ...[...added.values()].flat()];
  const asked = linesOf(judged);
  const held = asked.length === 0 ? [] : yield* Effect.mapError(subject.holders(asked), cutShort);
  const byLine = new Map(asked.map((line, at) => [placeOf(line), held[at] ?? []] as const));
  const absent = [...new Set(judged.flatMap((one) => one.absent ?? []))];
  const answered = subject.holds === undefined || absent.length === 0 ? [] : yield* Effect.mapError(subject.holds(absent), unheld);
  const holds = new Map<string, PreparedHold | undefined>(absent.map((path, at) => [path, answered[at]]));
  const holdingOf = (one: Found): Holding => {
    const line = lineOf(one);
    const writers = line === undefined ? [] : (byLine.get(placeOf(line)) ?? []);
    if (writers.length > 0) return { holders: writers };
    const stands = (one.absent ?? []).filter((path) => (holds.get(path)?._tag ?? 'missing') !== 'missing');
    const [only] = stands;
    if (stands.length !== 1 || only === undefined) return UNHELD;
    const hold = holds.get(only);
    if (hold?._tag === 'own') return { holders: [], withheld: only };
    return hold?._tag === 'peers' ? { holders: hold.holders, withheld: only } : UNHELD;
  };
  const holdersOf = (one: Found): readonly string[] => holdingOf(one).holders;
  const gone = linesOf([...removed.values()].flat());
  const proven = subject.removers === undefined || gone.length === 0 ? [] : yield* Effect.mapError(subject.removers(gone), cutShort);
  const ownRemoval = new Set(gone.filter((_, at) => proven[at]?._tag === 'own').map(placeOf));
  const chosen = new Map<string, readonly Found[]>();
  for (const [key, rows] of added) {
    const session = rows.filter((one) => holdersOf(one).length === 0);
    const peers = rows.filter((one) => holdersOf(one).length > 0);
    const credit = (removed.get(key) ?? []).filter((one) => {
      const line = lineOf(one);
      return line !== undefined && ownRemoval.has(placeOf(line));
    }).length;
    const picked = session.length - credit > 0 ? [...session, ...peers] : peers;
    chosen.set(key, picked.length === 0 ? (core.get(key) ?? []) : picked);
  }
  const violations = [...verdict.violations.filter((one) => !chosen.has(one.fingerprint)), ...[...chosen.values()].flat()];
  return violations.map((one): Attribution => ({ violation: wireOf(one), ...holdingOf(one) }));
});
