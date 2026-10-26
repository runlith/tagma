import { totalmem } from 'node:os';
import {
  type BindingReach,
  FACT_KINDS,
  type FactKind,
  type FactNeeds,
  type ProgramFacts,
  type ProgramSide,
} from '@tagma/inspection/program';
import { Effect, Option } from 'effect';
import type { JudgeLane } from '../workers/asks.js';
import { InspectionFailed, Inspections } from '../workers/inspectionLanes.js';

export const factsCeiling = (): number => Math.floor(totalmem() / 256);

export type FactsSubject = {
  readonly root: string;
  readonly tree: string;
  readonly base: string | null;
  readonly sides: readonly ProgramSide[];
  readonly lane?: JudgeLane;
};

const isKind = (need: string): need is FactKind => (FACT_KINDS as readonly string[]).includes(need);

export const programFacts = Effect.fn('enforcement.program.facts')(function* (
  subject: FactsSubject,
  reaches: readonly BindingReach[],
  needs: FactNeeds,
) {
  const sides: { side: ProgramSide['side']; commit: string; paths: ProgramSide['paths'] }[] = [];
  for (const side of subject.sides) {
    const commit = side.side === 'tree' ? subject.tree : subject.base;
    if (commit === null)
      return yield* new InspectionFailed({ cause: 'source', reason: 'a base side was asked for facts with no base commit' });
    sides.push({ side: side.side, commit, paths: side.paths });
  }
  const inspections = yield* Effect.serviceOption(Inspections);
  if (Option.isNone(inspections))
    return yield* new InspectionFailed({
      cause: 'host',
      reason: 'this server runs no inspection workers, so no facts can be read for a program',
    });
  const answered = yield* inspections.value.facts({
    lane: subject.lane ?? 'landing',
    root: subject.root,
    sides,
    reaches,
    needs: needs.facts.filter(isKind),
    context: needs.context ?? {},
    ceiling: factsCeiling(),
  });
  yield* Effect.annotateCurrentSpan({
    'facts.needs': needs.facts.join(','),
    'facts.bytes': answered.facts.bytes,
    'facts.files': answered.facts.sides.reduce((sum, side) => sum + side.files.length + side.reached.length, 0),
    'facts.memoHits': answered.hits,
  });
  return answered.facts satisfies ProgramFacts;
});
