import { toolPageText } from '@runlith/agent/tool/page';
import type { ExecutionState } from '@runlith/executions/protocol/execution';
import type { TerminalRow } from '../contract/wire/terminals.js';
import type { TerminalReading, TerminalWaited } from '../contract/wire/operationAnswers.js';
import { UNVOICED } from '../../platform/contract/service/presentation.js';
import type { VoiceRefused } from '../../platform/contract/wire/voiceAnswer.js';
import { type Addressed, type Answered, alsoWords, exitWords, refWords, stateWords, typedLines, waitLines } from './execution.js';
import { refusalLines } from '@runlith/agent/tool/refusal';

const refusedText = (answer: VoiceRefused): string => refusalLines(answer).join('\n');

const liveWords = (state: ExecutionState): string =>
  state.phase === 'ended' ? `ended${state.nativeExit === undefined ? '' : `, ${exitWords(state.nativeExit)}`}` : state.phase;

const portsWords = (listing: TerminalRow): string => {
  const listeners = listing.listeners?.listeners ?? [];
  const ports = [...new Set(listeners.map((listener) => listener.port))].sort((left, right) => left - right);
  return ports.length === 0 ? '' : ports.map((port) => `:${port}`).join(' ');
};

export const terminalLine = (listing: TerminalRow): string => {
  const { record } = listing;
  const where = `${record.execution.execution}:${record.execution.incarnation}`;
  const what = record.label ?? record.commandLine ?? record.program ?? 'terminal';
  const subject = listing.listeners?.subject;
  const parts = [
    where,
    `${record.holder} ${record.lifetime} ${record.transport}`,
    ...(record.heldBy === undefined ? [] : [`held for thread:${record.heldBy}`]),
    ...(record.launchedFor === undefined ? [] : [`launched for thread:${record.launchedFor}`]),
    ...(record.adoptedBy === undefined ? [] : [`a CLI in it is thread:${record.adoptedBy}`]),
    record.rootId === undefined ? 'unplaced' : `root ${record.rootId}`,
    what,
    ...(record.cwd === undefined ? [] : [record.cwd]),
    listing.state === undefined ? 'no live state' : liveWords(listing.state),
    portsWords(listing),
    alsoWords(record.execution, [
      listing.state?.ref,
      subject?._tag === 'Execution' ? subject.execution : undefined,
      ...(listing.listeners?.listeners ?? []).map((listener) => listener.association?.execution),
    ]),
  ].filter((part) => part !== '');
  return parts.join('  ');
};

export const terminalsText = (
  answer: Answered<{ readonly terminals: readonly TerminalRow[]; readonly total: number; readonly next: string | null }>,
): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  return toolPageText({
    rows: answer.terminals.map((listing) => ({ label: terminalLine(listing) })),
    total: answer.total,
    order: 'newest first',
    next: answer.next === null ? undefined : `read_terminals(cursor="${answer.next}")`,
    empty: 'no terminals held',
  });
};

function* readingLines(reading: typeof TerminalReading.Type): Generator<string> {
  const { terminal, state } = reading;
  const standing =
    state === null
      ? 'host not answering — no phase and no ending is known'
      : reading.endedWithHost
        ? 'ended with the execution host it ran in, which was replaced'
        : stateWords(state);
  yield `${refWords(terminal.execution)} ${standing} — ${terminal.lifetime} ${terminal.transport}, custody revision ${terminal.revision}, held by ${terminal.holder}${
    terminal.heldBy === undefined ? '' : ` for thread:${terminal.heldBy}`
  }`;
  const also = alsoWords(terminal.execution, [state?.ref]);
  if (also !== '') yield also;
  const what = [terminal.label, terminal.commandLine ?? terminal.program].filter((part) => part !== undefined);
  if (what.length > 0) yield what.join(' — ');
  const place = [
    terminal.cwd,
    terminal.rootId === undefined ? 'unplaced' : `root ${terminal.rootId}`,
    terminal.launchedFor === undefined ? undefined : `launched for thread:${terminal.launchedFor}`,
    terminal.adoptedBy === undefined ? undefined : `a CLI in it is thread:${terminal.adoptedBy}`,
    terminal.quarantine === undefined ? undefined : `quarantined: ${terminal.quarantine}`,
  ].filter((part) => part !== undefined);
  yield place.join(', ');
  if (reading.grid !== null) yield `grid ${reading.grid.columns}×${reading.grid.rows}`;
  yield `lanes: ${reading.lanes.length === 0 ? 'none' : reading.lanes.map((lane) => `${lane.kind} ${lane.writer}`).join(', ')}`;
  yield* typedLines(reading.typedBy);
}

export const readingVoice = (answer: Answered<typeof TerminalReading.Type>) => (answer.status === 'ok' ? readingLines(answer) : UNVOICED);

function* terminalWaitLines(waited: typeof TerminalWaited.Type, input: Addressed & { readonly waitMs: number }) {
  yield* waitLines(waited.waited, input, input.waitMs);
  yield* typedLines(waited.typedBy);
}

export const terminalWaitVoice = (answer: Answered<typeof TerminalWaited.Type>, input: Addressed & { readonly waitMs: number }) =>
  answer.status === 'ok' ? terminalWaitLines(answer, input) : UNVOICED;
