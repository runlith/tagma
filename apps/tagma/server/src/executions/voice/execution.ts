import type { ExecutionState, NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { ProcessWatchReading } from '@runlith/executions/protocol/stop';
import type { TerminalWaitAnswer } from '../contract/wire/terminals.js';
import type { TerminalReading } from '../contract/wire/operationAnswers.js';
import type { VoiceRefused } from '../../platform/contract/wire/voiceAnswer.js';
import { elapsedWords } from '../../platform/contract/wire/text.js';

export type Answered<T> = ({ readonly status: 'ok' } & T) | VoiceRefused;

export type Addressed = { readonly execution: string; readonly incarnation: number };

type TypedBy = (typeof TerminalReading.Type)['typedBy'];

export const refWords = (ref: Addressed): string => `${ref.execution}:${ref.incarnation}`;

export const alsoWords = (shown: Addressed, refs: readonly (Addressed | undefined)[]): string => {
  const own = refWords(shown);
  const others = [...new Set(refs.flatMap((ref) => (ref === undefined || refWords(ref) === own ? [] : [refWords(ref)])))];
  return others.length === 0 ? '' : `also names execution ${others.join(', ')}`;
};

export const exitWords = (exit: NativeExit | undefined): string =>
  exit === undefined ? 'no exit reported' : exit._tag === 'Code' ? `exit ${exit.code}` : `killed by ${exit.signal}`;

export const stateWords = (state: ExecutionState): string => {
  const phase = state.phase === 'ended' ? `ended, ${exitWords(state.nativeExit)}` : state.phase;
  const facts = [
    ...(state.unacquired === undefined ? [] : [`never started: ${state.unacquired}`]),
    ...(state.cleanup === 'residual' || state.cleanup === 'unverifiable' ? [`cleanup ${state.cleanup}`] : []),
    ...(state.record === 'available' ? [] : [`record ${state.record}`]),
  ];
  return [phase, ...facts].join(', ');
};

export const instantWords = (ms: number): string => {
  const instant = new Date(ms);
  return Number.isNaN(instant.getTime()) ? `${ms} ms past the epoch` : instant.toISOString();
};

export const megabytes = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;

export const costWords = (cost: ProcessCost | undefined): string =>
  cost === undefined
    ? ''
    : cost._tag === 'Measured'
      ? `cpu ${(cost.cpuMicros / 1_000_000).toFixed(1)} s, peak ${megabytes(cost.peakRssBytes)}`
      : `cost unmeasured (${cost.reason})`;

const UNWATCHED_WORDS = {
  'no-reader': 'this host reads no process table',
  'leader-unproven': 'its first process was never proven',
  ended: 'its ending took the set',
} as const;

export const processWords = (processes: ProcessWatchReading | undefined): string => {
  if (processes === undefined) return '';
  const watched = processes.watched
    ? 'watched'
    : `not watched — ${processes.unwatched === undefined ? 'no reason was given' : UNWATCHED_WORDS[processes.unwatched]}`;
  const counted = (tag: ProcessWatchReading['rulings'][number]['_tag']): number =>
    processes.rulings.filter((ruling) => ruling._tag === tag).length;
  const outcomes = [
    [counted('Ended'), 'ended by program rules'],
    [counted('Ending'), 'being ended by program rules'],
    [counted('Survived'), 'survived a program rule'],
    [counted('Unverifiable'), 'not known to have ended'],
    [counted('Unread'), 'unread'],
    [processes.omitted, 'more not listed'],
  ] as const;
  return `, ${processes.members} processes proven${processes.capped ? ' (the set is full)' : ''}, ${watched}${
    processes.failures === 0 ? '' : `, ${processes.failures} failed rounds`
  }${outcomes.flatMap(([count, words]) => (count === 0 ? [] : [`, ${count} ${words}`])).join('')}`;
};

export function* typedLines(typedBy: TypedBy): Generator<string> {
  if (typedBy === undefined || typedBy.length === 0) return;
  yield `typed into by others: ${typedBy.map(({ writer, at }) => `${writer} at ${at}`).join(', ')}`;
}

function* summaryLines(summary: ExecutionSummary, shown: Addressed): Generator<string> {
  const { custody, native } = summary;
  const also = alsoWords(shown, [summary.state.ref, summary.decision?.execution]);
  if (also !== '') yield also;
  yield `custody revision ${custody.revision}, held by ${custody.holder}${native.pid === undefined ? '' : `, pid ${native.pid}`}`;
  for (const stream of summary.streams) {
    yield `${stream.stream}: bytes ${stream.retainedFrom}–${stream.durableThrough} retained, parsed through ${stream.parsedThrough}, ${stream.ending}`;
  }
  if (summary.grid !== undefined) yield `grid ${summary.grid.columns}×${summary.grid.rows}`;
  yield `input accepted through byte ${summary.input.acceptedThrough}${
    summary.input.pendingBytes > 0 ? `, ${summary.input.pendingBytes} bytes of it not yet written to the child` : ''
  }`;
  if (summary.decision !== undefined)
    yield `${summary.decision._tag === 'Cancelled' ? `cancelled: ${summary.decision.cause} (${summary.decision.trigger})` : 'completed'} by host operation ${summary.decision.operation.operation}`;
  const spent = `${costWords(summary.cost)}${processWords(summary.processes)}`.replace(/^, /u, '');
  if (spent !== '') yield spent;
}

export function* waitLines(waited: TerminalWaitAnswer, ref: Addressed, waitMs: number): Generator<string> {
  switch (waited._tag) {
    case 'Decided':
      yield `${refWords(waited.summary.state.ref)} decided — ${stateWords(waited.summary.state)}`;
      yield* summaryLines(waited.summary, waited.summary.state.ref);
      return;
    case 'Undecided':
      yield `${refWords(ref)} still undecided after ${waitMs < 1000 ? `${waitMs} ms` : elapsedWords(waitMs)}; the wait ended nothing — ${
        waited.summary === undefined ? 'no summary was observed' : stateWords(waited.summary.state)
      }`;
      if (waited.summary !== undefined) yield* summaryLines(waited.summary, ref);
      return;
    case 'Unwatchable':
      yield `${refWords(ref)} unwatchable — the host holds nothing under this reference, which is not an ending`;
  }
}
