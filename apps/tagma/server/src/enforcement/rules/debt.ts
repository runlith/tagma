import { Effect } from 'effect';
import { followedDebt, lineageFrom, needsLineage, renamedBetween } from '../lineage.js';
import type { BlockRow } from '../../graph/contract/service/acts.js';
import type { Measurement } from '../contract/wire/enforcement.js';
import type { Assembled } from '@tagma/inspection/builtins';
import { type CountedDebt, type Programmed, isProgrammed } from '../contract/wire/document.js';
import { awaitingLanding } from './held.js';
import type { Measured } from './measure.js';
import { ledgerHasSources } from './ledger.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export const measuredDebt = Effect.fnUntraced(function* (input: {
  readonly rule: BlockRow;
  readonly inspection: Assembled | Programmed;
  readonly debt: readonly CountedDebt[];
  readonly measured: Measured;
  readonly previous?: Measurement;
  readonly confirmed?: ReadonlySet<string>;
  readonly reserved?: readonly CountedDebt[];
}) {
  const { rule, inspection, debt, measured, previous } = input;
  const renaming =
    !isProgrammed(inspection) &&
    needsLineage(
      debt.filter((one) => one.held === undefined),
      measured.found,
    );
  if (renaming && previous?.sources !== undefined && !ledgerHasSources({ debt, escaped: [] }, previous.sources)) {
    return yield* new GateRefusal(
      'inspection-failed',
      'the debt and its measurement no longer describe the same fingerprints, so rename lineage is unproved',
      ['read_enforcement shows the current debt; check_rules over all measures the rule at HEAD'],
    );
  }
  const renamed =
    renaming && !isProgrammed(inspection)
      ? yield* renamedBetween(measured.root, yield* lineageFrom(measured.root, rule, previous), measured.head, inspection.params.base)
      : [];
  const carried = isProgrammed(inspection) ? debt : followedDebt(inspection, debt, measured.found, renamed, input.reserved);
  const followed = carried.flatMap((one, at) => (one === debt[at] ? [] : [{ from: debt[at]?.fingerprint ?? '', to: one.fingerprint }]));
  const awaiting = input.confirmed ?? (yield* awaitingLanding(measured.root, measured.head, carried, new Set(measured.found.keys())));
  const stands = (fingerprint: string) => measured.found.has(fingerprint) || awaiting.has(fingerprint);
  const standing = carried.filter((one) => stands(one.fingerprint));
  const remaining = standing.map((entry) => {
    const one = measured.found.get(entry.fingerprint);
    if (one === undefined) return entry;
    const count = Math.min(entry.count ?? 1, measured.counts.get(entry.fingerprint) ?? 1);
    return { fingerprint: entry.fingerprint, owner: entry.owner, count: count === 1 ? undefined : count, value: one.value };
  });
  return { debt: remaining, standing, retired: carried.filter((one) => !stands(one.fingerprint)), followed };
});
