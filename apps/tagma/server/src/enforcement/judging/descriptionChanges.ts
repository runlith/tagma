import { newViolations, siteRows } from '@tagma/inspection/verdict';
import type { Assembled } from '@tagma/inspection/builtins';
import { canonicalJson } from '@runlith/utils/object';
import { Effect, Result } from 'effect';
import type { ConfigVersion } from '../../config/contract/service/configs.js';
import { CONFIG_FILE } from '../../config/contract/wire/config.js';
import type { CountedDebt, Programmed } from '../contract/wire/document.js';
import { describedBy, isProgrammed } from '../contract/wire/document.js';
import { type CheckedViolation, crossingOf, type LandingUnjudged } from '../contract/wire/enforcement.js';
import type { Norm } from '../contract/wire/findings.js';
import { descriptionsAt } from '../rules/descriptions.js';
import { judgedDebt } from '../rules/held.js';
import { indexViolations, measureAt, type ViolationIndex } from '../rules/measure.js';
import { judgeBindings, type BoundRule } from '../programs/bindings.js';
import type { InspectionFailed } from '../workers/inspectionLanes.js';
import type { JudgeLane } from '../workers/asks.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { Reading } from './merged.js';
import { wireOf } from './excess.js';

export const changedKeys = Effect.fn('enforcement.changedKeys')(function* (
  version: ConfigVersion,
  base: string,
  paths: readonly string[],
  keys: readonly string[],
) {
  const changed = new Set<string>();
  if (keys.length === 0) return changed;
  const after = yield* descriptionsAt(version);
  if ('config' in after) {
    const inputs = new Set([CONFIG_FILE, ...(after.config?.footprint ?? [])]);
    if (!paths.some((path) => inputs.has(path))) return changed;
  }
  const before = yield* descriptionsAt({ ...version, tree: base });
  for (const key of new Set(keys)) {
    if (canonicalJson(describedBy(before, key)) !== canonicalJson(describedBy(after, key))) changed.add(key);
  }
  return changed;
});

export type ReachRule = {
  readonly norm: Norm;
  readonly inspection: Assembled | Programmed;
  readonly places: readonly string[];
  readonly debt: readonly CountedDebt[];
};

type ReachFindings = {
  readonly violations: readonly CheckedViolation[];
  readonly unjudged: readonly LandingUnjudged[];
  readonly counts: ReadonlyMap<string, number>;
};

type ReachReading = { readonly answer: Result.Result<ReachFindings, InspectionFailed>; readonly ms: number };

export const measureRules = Effect.fn('enforcement.measureRules')(function* (
  version: ConfigVersion,
  rules: readonly ReachRule[],
  caller: TerminalActor | null,
  lane: JudgeLane = 'landing',
) {
  const readings = new Map<string, ReachReading>();
  const bound = yield* judgeBindings(
    { ...version, built: version.tree, caller, base: null, paths: null, lane },
    rules.flatMap((rule): BoundRule[] =>
      isProgrammed(rule.inspection) ? [{ rule: rule.norm.rule, inspection: rule.inspection, places: rule.places, debt: rule.debt }] : [],
    ),
  );
  for (const rule of rules) {
    const { inspection, norm } = rule;
    const started = performance.now();
    const answer: Result.Result<Reading & ViolationIndex, InspectionFailed> = isProgrammed(inspection)
      ? Result.map(bound.get(norm.rule)!.answer, (reading) => ({ ...reading, ...indexViolations(reading.verdict.violations) }))
      : yield* Effect.result(measureAt(version.root, version.tree, inspection, rule.places));
    const ms = isProgrammed(inspection) ? bound.get(norm.rule)!.ms : Math.round(performance.now() - started);
    readings.set(norm.rule, {
      ms,
      answer: Result.map(answer, (measured): ReachFindings => {
        const fresh = new Set(newViolations(measured.verdict.violations, [], judgedDebt(rule.debt)).violations);
        return {
          counts: measured.counts,
          violations: measured.verdict.violations.flatMap((unit) =>
            siteRows([unit]).map((violation) => ({
              ...crossingOf(norm, inspection, wireOf(violation)),
              owed: fresh.has(unit) ? undefined : true,
            })),
          ),
          unjudged: measured.verdict.unjudged.map((one) => ({ rule: norm.rule, ...one })),
        };
      }),
    });
  }
  return readings;
});
