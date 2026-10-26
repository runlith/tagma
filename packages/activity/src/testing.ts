import { Effect } from 'effect';
import type { ActivityFact, ActivityNote, ActivityOpened, ActivityOutcome } from './fact';
import type { ActivityLog } from './log';

export type RecordedNote = ActivityNote & Readonly<Record<string, unknown>>;

export type RecordedActivity = {
  readonly opened: ActivityOpened;
  readonly notes: RecordedNote[];
  readonly bodies: string[];
  ended: {
    readonly outcome: ActivityOutcome;
    readonly reason: string | null;
    readonly message: string | null;
    readonly result: object;
  } | null;
};

export type ActivityRecording = {
  readonly log: ActivityLog;
  readonly facts: readonly ActivityFact[];
  activities(): readonly RecordedActivity[];
  runNotes(run: string): readonly RecordedNote[];
};

export function activityRecording(): ActivityRecording {
  const facts: ActivityFact[] = [];
  return {
    log: { record: (fact) => void facts.push(fact), settled: Effect.void },
    facts,
    activities: () => {
      const byId = new Map<string, RecordedActivity>();
      for (const fact of facts) {
        if (fact._tag === 'Opened') {
          byId.set(fact.id, { opened: fact, notes: [], bodies: [], ended: null });
          continue;
        }
        const target = typeof fact.activity === 'string' ? byId.get(fact.activity) : undefined;
        if (target === undefined) continue;
        if (fact._tag === 'Noted') target.notes.push(fact.note as RecordedNote);
        else if (fact._tag === 'Bodied') target.bodies.push(fact.body.kind);
        else target.ended = { outcome: fact.outcome, reason: fact.reason, message: fact.message, result: fact.result };
      }
      return [...byId.values()];
    },
    runNotes: (run) =>
      facts.flatMap((fact) =>
        fact._tag === 'Noted' && typeof fact.activity !== 'string' && fact.activity.run === run ? [fact.note as RecordedNote] : [],
      ),
  };
}
