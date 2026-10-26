import { commitOf, troubleOf } from '@runlith/git/repository';
import { diffTreeAt } from '@runlith/git/trees';
import { Git } from '@runlith/git/Git';
import { Effect, Result } from 'effect';
import type { DebtAt, DebtReport } from '../../graph/contract/service/workDebt.js';
import type { RemainingDebt } from '../../graph/contract/wire/answers.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { actingGit } from '../../platform/git/ownGit.js';
import { inspectionBase, inspectionFileLocal } from '../contract/wire/enforcement.js';
import { isProgrammed, isUnrun, unrunReason } from '../contract/wire/document.js';
import { enforcedRules, enforcedStatutes } from './reach.js';
import { measureAt } from './measure.js';
import { measureBound } from './measureBound.js';
import { measuredDebt } from './debt.js';
import { measurementsOf } from './measurements.js';
import { gitUnread } from '../workers/unread.js';

export const endingDebt = Effect.fn('enforcement.endingDebt')(function* ({ projectId, root, owner, commit }: DebtAt) {
  const git = actingGit(yield* Git, 'enforcement-ending');
  const head = yield* commitOf(git, root, commit).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('inspection-failed', `the completion commit ${commit} could not be read: ${troubleOf(failure)}`, [
          'read_enforcement and check_rules over all show the rule and its inspection failure',
        ]),
    ),
  );
  if (head === null) return { debtUnreadable: [`the completion commit ${commit} could not be resolved`] } satisfies DebtReport;
  const rules = yield* enforcedStatutes(projectId);
  const previous = yield* measurementsOf(
    root,
    rules.filter((entry) => entry.document?.debt.some((one) => one.owner === owner)).map((entry) => entry.rule.uuid),
  );
  const entries = yield* enforcedRules(projectId, { projectId, root, tree: head, actor: { _tag: 'Operator' } });
  const debt: RemainingDebt[] = [];
  const unreadable: string[] = [];
  for (const entry of entries) {
    const name = blockName(entry.rule.uuid);
    if (entry.document === null) {
      unreadable.push(`${name}: ${entry.unreadable.reason}`);
      continue;
    }
    const owned = entry.document.debt.filter((one) => one.owner === owner);
    if (owned.length === 0) continue;
    const checked = yield* Effect.result(
      Effect.gen(function* () {
        const inspection = entry.document.check;
        if (isUnrun(inspection))
          return yield* new GateRefusal('inspection-failed', unrunReason(entry.document.inspection, inspection), [
            'read_enforcement and check_rules over all show the rule and its inspection failure',
          ]);
        const places = yield* entry.reach(inspectionBase(inspection));
        const prior = previous.get(entry.rule.uuid);
        const sources = owned.map((one) => prior?.sources?.[one.fingerprint] ?? one.held?.path);
        let paths: readonly string[] | undefined;
        if ((isProgrammed(inspection) || inspectionFileLocal(inspection)) && sources.every((source) => source !== undefined)) {
          const moved = prior === undefined ? [] : yield* diffTreeAt(git, root, prior.commit, head).pipe(Effect.mapError(gitUnread));
          paths = [...new Set([...sources, ...moved.map((one) => one.path)])];
        }
        const measured = isProgrammed(inspection)
          ? yield* measureBound(projectId, root, head, name, inspection, places, { _tag: 'Operator' }, paths)
          : yield* measureAt(root, head, inspection, places, 'foreground', undefined, paths).pipe(
              Effect.catchTag('InspectionFailed', (failure) =>
                Effect.fail(
                  new GateRefusal('inspection-failed', `(${failure.cause}) ${failure.reason}`, [
                    'check_rules over all shows the inspection failure',
                  ]),
                ),
              ),
            );
        if (measured.verdict.unjudged.length > 0)
          return yield* new GateRefusal('inspection-failed', 'the completion commit was not fully inspected', [
            'read_enforcement and check_rules over all show the rule and its inspection failure',
          ]);
        return (yield* measuredDebt({
          rule: entry.rule,
          inspection,
          debt: owned,
          measured,
          previous: prior,
          reserved: entry.document.debt,
        })).debt.length;
      }),
    );
    if (Result.isFailure(checked)) {
      unreadable.push(`${name}: ${checked.failure.message}`);
      continue;
    }
    if (checked.success === 0) continue;
    debt.push({
      rule: name,
      title: entry.rule.title,
      entries: checked.success,
      reassign: `read_enforcement with rule=${name} supplies base and debt fingerprints; enforce_rule with blockId=${name} and owners mapping those owned by ${owner} to a standing task or spec`,
    });
  }
  return {
    debt: debt.length === 0 ? undefined : debt,
    debtUnreadable: unreadable.length === 0 ? undefined : unreadable,
  } satisfies DebtReport;
});
