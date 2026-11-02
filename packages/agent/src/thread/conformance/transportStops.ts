import { afterAll, describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, Schedule, type Scope } from 'effect';
import { entryOf } from '../../transcript/kinds';
import type { ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadStop } from '../ending';
import type { ThreadRunStatus } from '../rows';
import { occurrences } from './transportWords';

export const STOP_STATES = [
  'opening',
  'thinking',
  'writing',
  'tagma-call',
  'vendor-call',
  'question',
  'compaction-step',
  'compaction-end',
  'reopening',
  'steer-unechoed',
  'steer-echoed',
  'natural-end',
  'unlinked',
  'restarted',
  'repeated',
] as const;

export type StopState = (typeof STOP_STATES)[number];

export type StoppedRun = {
  readonly status: ThreadRunStatus;
  readonly stoppedBy: string | null;
  readonly finishedAt: Date;
};

export type RunJournal = { readonly entries: readonly ThreadTranscriptEntry[]; readonly tail: unknown };

const operatorWord = entryOf('signal');
const question = entryOf('question');

const agentSaid = (journal: RunJournal): RunJournal => {
  const asked = new Set<string>();
  return {
    entries: journal.entries.flatMap((entry): readonly ThreadTranscriptEntry[] => {
      if (operatorWord(entry) && entry.addressee === 'reader') return [];
      if (!question(entry)) return [entry];
      if (asked.has(entry.id)) return [];
      asked.add(entry.id);
      return [
        {
          type: entry.type,
          id: entry.id,
          runId: entry.runId,
          questionId: entry.questionId,
          questions: entry.questions,
          toolCalls: entry.toolCalls,
          status: 'open' as const,
        },
      ];
    }),
    tail: journal.tail,
  };
};

export const STEER_WORDS = 'Use the other table.';

export type StopCase = {
  readonly runId: string;
  stop(): Effect.Effect<ThreadStop, unknown>;
  ended(): Effect.Effect<StoppedRun | null, unknown>;
  journal(): Effect.Effect<RunJournal, unknown>;
  heard(): Effect.Effect<string, unknown>;
  agentTurns(): Effect.Effect<number, unknown>;
  interrupts(): Effect.Effect<number, unknown>;
  runsAfter(): Effect.Effect<number, unknown>;
  settle(): Effect.Effect<void, unknown>;
};

export type Unreachable = { readonly unreachable: string };

export type StopRig<R = never> = {
  reach(state: StopState): Effect.Effect<StopCase | Unreachable, unknown, Scope.Scope | R>;
};

const WAKES: Partial<Record<StopState, number>> = { 'steer-unechoed': 1, 'compaction-step': 1 };

type Measured = { readonly transport: string; readonly state: StopState; readonly ms: number | null; readonly note: string };

const measured: Measured[] = [];

const ended = (reached: StopCase) =>
  Effect.flatMap(reached.ended().pipe(Effect.repeat({ while: (run) => run === null, schedule: Schedule.spaced(5) })), (run) =>
    run === null ? Effect.die(new Error('the run was never seen ending')) : Effect.succeed(run),
  );

const answered = (answer: ThreadStop, runId: string, state: StopState): string => {
  expect(['stopped', 'requested', 'nothing-running']).toContain(answer.status);
  if (state === 'natural-end') return answer.status;
  expect(answer).toEqual({ status: 'stopped', runId });
  return answer.status;
};

export function describeTransportStops<R>(
  transport: string,
  make: () => Effect.Effect<StopRig<R>, unknown, Scope.Scope | R>,
  test: Tester<Scope.Scope | R>,
  states: readonly StopState[] = STOP_STATES,
): void {
  describe(`${transport}: Esc ends the run at once in every state, and nothing of it goes on`, () => {
    afterAll(() => {
      const rows = measured.filter((row) => row.transport === transport);
      if (rows.length === 0) return;
      const lines = rows.map((row) => `| ${row.state} | ${row.ms === null ? 'n/a' : `${row.ms} ms`} | ${row.note} |`);
      process.stdout.write(`\nEsc → run end on ${transport}\n| state | stop → end | answer |\n|---|---|---|\n${lines.join('\n')}\n`);
    });
    for (const state of states)
      test(
        `Esc ${state === 'repeated' ? 'pressed twice' : `in the state ${state}`}`,
        Effect.fnUntraced(function* () {
          const rig = yield* make();
          const reached = yield* rig.reach(state);
          if ('unreachable' in reached) {
            measured.push({ transport, state, ms: null, note: reached.unreachable });
            return;
          }
          const turns = yield* reached.agentTurns();
          const pressed = yield* Clock.currentTimeMillis;
          const answer = yield* reached.stop();
          const status = answered(answer, reached.runId, state);
          const run = yield* ended(reached);
          const ms = run.finishedAt.getTime() - pressed;
          if (status !== 'nothing-running') {
            expect(run.status).toBe('aborted');
            expect(run.stoppedBy).not.toBeNull();
          }
          const sealed = agentSaid(yield* reached.journal());
          if (state === 'repeated') {
            const told = yield* reached.interrupts();
            expect(['stopped', 'requested', 'nothing-running']).toContain((yield* reached.stop()).status);
            yield* reached.interrupts().pipe(Effect.repeat({ while: (count) => count <= told, schedule: Schedule.spaced(5) }));
          }
          yield* reached.settle();
          expect(agentSaid(yield* reached.journal())).toEqual(sealed);
          const after = yield* reached.runsAfter();
          expect(after).toBeLessThanOrEqual(WAKES[state] ?? 0);
          if (state === 'steer-unechoed') {
            expect(after).toBe(1);
            expect(occurrences(yield* reached.heard(), STEER_WORDS)).toBe(1);
          }
          expect((yield* reached.agentTurns()) - turns).toBe(after);
          measured.push({ transport, state, ms: Math.max(0, ms), note: status });
        }),
      );
  });
}
