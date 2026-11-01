import { Effect, Result } from 'effect';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { isLinter, type Programmed } from '../contract/wire/document.js';
import { reachSaid } from '../contract/wire/enforcement.js';
import { judgeBindings } from '../programs/bindings.js';
import { indexViolations, type Measured } from './measure.js';

const unmeasured = (reason: string, ways: readonly string[] = []) =>
  new GateRefusal('inspection-failed', reason, [
    'check_rules with the rule over `all` runs its program or linter and shows why it fails; fix it and enforce again',
    ...ways,
  ]);

export const measureBound = Effect.fn('enforcement.measureBound')(function* (
  projectId: number,
  root: string,
  head: string,
  rule: string,
  inspection: Programmed,
  places: readonly string[],
  caller: TerminalActor | null,
  paths?: readonly string[],
  priority: 'foreground' | 'background' = 'foreground',
  basis?: string,
) {
  const run = (yield* judgeBindings(
    {
      projectId,
      root,
      built: head,
      base: isLinter(inspection.program) ? null : (basis ?? null),
      paths: paths ?? null,
      caller,
      lane: 'landing',
      priority,
      mode: 'measure',
    },
    [{ rule, inspection, places, debt: [] }],
  )).get(rule);
  const read = run?.answer;
  if (read === undefined || Result.isFailure(read)) {
    return yield* unmeasured(
      `the checks over ${reachSaid(places)} at ${head} could not run${read === undefined ? '' : ` (${read.failure.cause}): ${read.failure.reason}`}`,
      read?.failure.ways,
    );
  }
  const { found, counts } = indexViolations(read.success.verdict.violations);
  const measured: Measured = {
    verdict: read.success.verdict,
    remeasure: read.success.remeasure,
    footprint: read.success.footprint,
    read: null,
    ms: run!.ms,
    root,
    head,
    found,
    counts,
    coverage: read.success.coverage,
  };
  return measured;
});
