import {
  sameNamespace,
  sameProcess,
  type EvidenceNamespace,
  type ProcessReport,
  type ProcessSnapshot,
  type ProcessWitness,
} from '@runlith/executions/protocol/evidence';
import type { ForegroundAnswer } from '@runlith/executions/protocol/terminal';
import { Effect } from 'effect';

export type JobProof =
  | { readonly _tag: 'Job'; readonly witness: ProcessWitness }
  | { readonly _tag: 'NotUnder'; readonly reason: string; readonly final?: true }
  | { readonly _tag: 'Unread'; readonly reason: string };

export type JobState = 'foreground' | 'background' | 'gone' | 'unread';

export const RETAINED_READING_MS = 1_100;

const leaderOf = (report: ProcessReport): ProcessSnapshot | undefined =>
  report.processes.find((row) => row.association?.relation === 'leader' && row.association.identity === 'same');

const unread = (report: ProcessReport | undefined): string | null => {
  if (report === undefined) return 'the host holds no execution under that terminal';
  if (report.completeness !== 'complete') return `the reading of that terminal's processes was ${report.completeness}`;
  return leaderOf(report) === undefined ? "the reading does not identify the terminal's own shell" : null;
};

export const jobUnder = (
  report: ProcessReport | undefined,
  ancestry: readonly number[],
  namespace: EvidenceNamespace,
  foreground: ForegroundAnswer,
): JobProof => {
  if (foreground._tag === 'ForegroundRefused') return { _tag: 'Unread', reason: foreground.detail };
  const missing = unread(report);
  if (report === undefined || missing !== null) return { _tag: 'Unread', reason: missing ?? 'unread' };
  if (!sameNamespace(report.scope.host, namespace)) {
    return { _tag: 'NotUnder', reason: 'the caller reads its processes in another namespace than the terminal', final: true };
  }
  const leader = leaderOf(report)!.identity.pid;
  const at = ancestry.indexOf(leader);
  if (at <= 0) return { _tag: 'NotUnder', reason: "the caller's ancestry does not pass through the terminal's shell", final: true };
  const rows = new Map(report.processes.filter((row) => row.association !== undefined).map((row) => [row.identity.pid, row]));
  const chain: ProcessSnapshot[] = [];
  for (let index = 0; index < at; index += 1) {
    const row = rows.get(ancestry[index]!);
    if (row === undefined || row.parent !== ancestry[index + 1]) {
      return { _tag: 'NotUnder', reason: `process ${ancestry[index]} does not descend from the terminal's shell in the reading` };
    }
    chain.push(row);
  }
  const candidate = chain.find((row) => row.identity.pid === foreground.process.pid);
  if (candidate !== undefined && candidate.identity.birth === undefined) {
    return { _tag: 'Unread', reason: 'the reading carries no birth witness for the foreground process' };
  }
  const job = candidate !== undefined && sameProcess(candidate.identity, foreground.process) ? candidate : undefined;
  return job === undefined
    ? { _tag: 'NotUnder', reason: "no process between the caller and the terminal's shell leads the terminal's foreground work" }
    : { _tag: 'Job', witness: foreground.process };
};

export const jobState = <E, R>(
  report: ProcessReport | undefined,
  witness: ProcessWitness,
  foreground: Effect.Effect<ForegroundAnswer, E, R>,
): Effect.Effect<JobState, E, R> =>
  Effect.suspend(() => {
    if (report === undefined || unread(report) !== null) return Effect.succeed('unread');
    const job = report.processes.find((row) => row.identity.pid === witness.pid && row.association !== undefined);
    if (job === undefined) return Effect.succeed('gone');
    if (job.identity.birth === undefined) return Effect.succeed('unread');
    if (!sameProcess(job.identity, witness)) return Effect.succeed('gone');
    return Effect.map(foreground, (answer) => {
      if (answer._tag === 'ForegroundRefused') return 'unread';
      if (answer.process.pid === witness.pid && !sameProcess(witness, answer.process)) return 'gone';
      return sameProcess(witness, answer.process) ? 'foreground' : 'background';
    });
  });
