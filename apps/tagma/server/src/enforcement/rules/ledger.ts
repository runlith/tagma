import { Data } from 'effect';
import type { Ledger } from '../contract/wire/document.js';
import type { InspectionCoverage, RuleViolation } from '../contract/wire/enforcement.js';

type Sources = Readonly<Record<string, string>>;

class LedgerSourcesMissing extends Data.TaggedError('LedgerSourcesMissing') {
  override readonly message = 'a partial ledger needs the measured source of every debt entry';
}

export const ledgerHasSources = (ledger: Ledger, sources: Sources | undefined): sources is Sources =>
  sources !== undefined && ledger.debt.every((entry) => Object.hasOwn(sources, entry.fingerprint));

export const ledgerSources = (ledger: Ledger, found: ReadonlyMap<string, RuleViolation>, prior?: Sources): Sources =>
  Object.fromEntries(
    ledger.debt.flatMap(({ fingerprint, held }) => {
      const file = found.get(fingerprint)?.file ?? prior?.[fingerprint] ?? held?.path;
      return file === undefined ? [] : [[fingerprint, file]];
    }),
  );

export const partitionLedger = (ledger: Ledger, paths?: readonly string[], sources?: Sources, coverage?: readonly InspectionCoverage[]) => {
  if (paths === undefined) return { selected: ledger, merge: (next: Ledger): Ledger => next };
  if (!ledgerHasSources(ledger, sources)) throw new LedgerSourcesMissing();
  const touched = new Set(paths);
  const bindings = coverage?.map(({ prefix, paths }) => ({ prefix, paths: paths === null ? null : new Set(paths) }));
  const covered = (fingerprint: string, path: string): boolean =>
    bindings === undefined
      ? touched.has(path)
      : bindings.some((binding) => fingerprint.startsWith(binding.prefix) && (binding.paths === null || binding.paths.has(path)));
  const affected = new Set(
    ledger.debt.filter((entry) => covered(entry.fingerprint, sources[entry.fingerprint]!)).map((entry) => entry.fingerprint),
  );
  const escaped = new Set(ledger.escaped.filter((entry) => covered(entry.fingerprint, entry.path)).map((entry) => entry.fingerprint));
  return {
    selected: {
      debt: ledger.debt.filter((entry) => affected.has(entry.fingerprint)),
      escaped: ledger.escaped.filter((entry) => escaped.has(entry.fingerprint)),
    } satisfies Ledger,
    merge: (next: Ledger): Ledger => {
      const changedDebt = new Map(next.debt.map((entry) => [entry.fingerprint, entry]));
      const standingKeys = new Set(ledger.debt.map((entry) => entry.fingerprint));
      return {
        debt: [
          ...ledger.debt.flatMap((entry) => (affected.has(entry.fingerprint) ? (changedDebt.get(entry.fingerprint) ?? []) : entry)),
          ...next.debt.filter((entry) => !standingKeys.has(entry.fingerprint)),
        ],
        escaped: [...ledger.escaped.filter((entry) => !escaped.has(entry.fingerprint)), ...next.escaped],
      };
    },
  };
};
