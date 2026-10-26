import type { CommandDeadline, CommandRevisionAnswer } from '@runlith/executions/protocol/command';
import type { UsageReading } from '@runlith/executions/protocol/evidence';
import type { EndingReceipt, StopReceipt } from '@runlith/executions/protocol/stop';
import type {
  CommandListAnswer,
  CommandOutputReading,
  CommandReading,
  CommandSearchReading,
  OutputStanding,
} from '../contract/wire/commands.js';
import type { CommandWaited } from '../contract/wire/operationAnswers.js';
import { subjectKeyOf } from '../contract/wire/commandSubject.js';
import { UNVOICED } from '../../platform/contract/service/presentation.js';
import type { VoiceRefused } from '../../platform/contract/wire/voiceAnswer.js';
import {
  type Addressed,
  type Answered,
  alsoWords,
  costWords,
  exitWords,
  instantWords,
  megabytes,
  processWords,
  refWords,
  waitLines,
} from './execution.js';
import type { CommandTimeRecord } from '../contract/wire/commands.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { elapsedWords } from '../../platform/contract/wire/text.js';

const refusedText = (answer: VoiceRefused): string => refusalLines(answer).join('\n');

const named = (reading: { readonly commandLine?: string | undefined; readonly label?: string | undefined }): string =>
  reading.commandLine ?? reading.label ?? 'command';

export const outputHeader = (reading: OutputStanding): string => {
  const what = named(reading);
  const ran = elapsedWords(reading.elapsedMs);
  switch (reading.phase) {
    case 'ended':
      return `${what} — ended, ${exitWords(reading.exit)}${ran === '' ? '' : ` after ${ran}`}`;
    case 'running':
      return `${what} — running${ran === '' ? '' : ` for ${ran}`}`;
    case 'queued':
      return `${what} — accepted, its process not yet started`;
    case 'unheld':
      return `${what} — the host no longer holds this command; its record may be gone`;
    case 'unavailable':
      return `${what} — the host could not be read; whether it runs is not known`;
  }
};

export const outputText = (answer: Answered<CommandOutputReading>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  const lines = [`${refWords(answer.execution)} ${outputHeader(answer)}`];
  if (answer.evicted === true) {
    lines.push('(its output is no longer kept on this host)');
    return lines.join('\n');
  }
  if (answer.skippedBytes > 0) lines.push(`(${answer.skippedBytes} bytes before this window were not read)`);
  lines.push(answer.output === '' ? (answer.first ? '(no output)' : '(no new output)') : answer.output);
  if (answer.measurement !== undefined) lines.push('', answer.measurement);
  return lines.join('\n');
};

export const searchText = (answer: Answered<CommandSearchReading>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  const counted = answer.total === 0 ? 'no line matches' : `${answer.shown} of ${answer.total} matching lines`;
  const lines = [
    `${refWords(answer.execution)} ${outputHeader(answer)}`,
    answer.next === null ? `(${counted})` : `(${counted}; continue with cursor: ${answer.next})`,
  ];
  for (const kept of answer.searched) {
    lines.push(
      `(${kept.stream} searched bytes ${kept.from}..${kept.through}${kept.from === '0' ? '' : '; earlier output is gone and its lines count from there'})`,
    );
  }
  let previous: { readonly stream: string; readonly line: number } | undefined;
  for (const match of answer.matches) {
    const first = match.before[0]?.line ?? match.line;
    if (previous !== undefined && (previous.stream !== match.stream || first > previous.line + 1)) lines.push('--');
    for (const near of match.before) lines.push(`${match.stream}-${near.line}-${near.text}`);
    lines.push(`${match.stream}:${match.line}:${match.offset}:${match.text}`);
    for (const near of match.after) lines.push(`${match.stream}-${near.line}-${near.text}`);
    previous = { stream: match.stream, line: match.after.at(-1)?.line ?? match.line };
  }
  return lines.join('\n');
};

export const stopText = (answer: Answered<{ readonly receipt: StopReceipt }>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  const { receipt } = answer;
  const ladder = receipt.steps.length === 0 ? '; steps: none' : ` at ${receipt.steps.join(' → ')}`;
  const spent = costWords(receipt.cost);
  const lines = [
    `${refWords(receipt.execution)} stopped by operation ${receipt.operation.operation}: ${exitWords(receipt.nativeExit)}${ladder}${
      receipt.unacquired === undefined ? '' : ` — it never started: ${receipt.unacquired}`
    }${spent === '' ? '' : `; ${spent}`}${receipt.cost._tag === 'Unmeasured' ? ` — ${receipt.cost.detail}` : ''}`,
    `installation ${receipt.execution.installation}; operation installation ${receipt.operation.installation}; requested ${receipt.requested}; cause ${receipt.cause}`,
    `coverage: ${receipt.coverage.length === 0 ? 'none' : receipt.coverage.join(', ')}; relation ${receipt.relation}; cleanup ${receipt.cleanup}; retention ${receipt.retention}`,
    `confirmed: ${receipt.confirmed.length}`,
  ];
  for (const ended of receipt.confirmed) {
    lines.push(
      `ended: pid ${ended.pid} (${ended.relation}) — ${exitWords(ended.exit)}${ended.step === undefined ? '' : ` at ${ended.step}`}`,
    );
  }
  lines.push(`survived: ${receipt.residual.length}`);
  for (const left of receipt.residual) {
    lines.push(
      `survived: ${left.kind}${left.pid === undefined ? '' : ` pid ${left.pid}`}${left.relation === undefined ? '' : ` (${left.relation})`} — ${left.detail}`,
    );
  }
  lines.push(`unverified: ${receipt.unverifiable.length}`);
  for (const unknown of receipt.unverifiable) {
    lines.push(`unverified: ${unknown.kind} — ${unknown.detail} (${unknown.reason})`);
  }
  lines.push(`streams: ${receipt.streams.length}`);
  for (const stream of receipt.streams) lines.push(`${stream.stream}: ${stream.ending}`);
  lines.push(`output abandoned: ${receipt.abandonedOutput ? 'yes' : 'no'}`);
  return lines.join('\n');
};

const boundWords = (deadline: CommandDeadline): string =>
  deadline.executionMs === undefined
    ? 'no life bound'
    : `life ${elapsedWords(deadline.executionMs)}${deadline.ceilingMs === undefined ? '' : ` (ceiling ${elapsedWords(deadline.ceilingMs)})`}`;

const ORIGIN_WORDS = { caller: 'asked by its caller', default: 'the default', rule: 'set by a rule' } as const;

const machineWords = (copy: { readonly machine?: true }): string => (copy.machine === true ? ' for every project' : '');

const timeWords = (deadline: CommandDeadline, time: CommandTimeRecord | undefined): string => {
  const asked =
    time === undefined
      ? ''
      : time.requested === undefined
        ? ', its call asked no life'
        : time.requested === 'none'
          ? ', its call asked no life bound'
          : `, its call asked a life of ${elapsedWords(time.requested)}`;
  const rules =
    time === undefined || time.rules.length === 0
      ? ''
      : `, rule ${time.rules.map((copy) => `${copy.id}${machineWords(copy)} "${copy.words}"`).join(', ')}`;
  const programs =
    time?.programs === undefined
      ? ''
      : `, program rules ${time.programs.rules
          .map(
            (copy) =>
              `${copy.id}${machineWords(copy)} "${copy.program.words.join(' ')}"${copy.program.folder === undefined ? '' : ` in ${copy.program.folder}`} ${elapsedWords(copy.limitMs)}`,
          )
          .join(', ')}`;
  return `${boundWords(deadline)} ${ORIGIN_WORDS[deadline.origin]}${asked}${rules}${programs}`;
};

const deadlineWords = (deadline: CommandDeadline): string =>
  `${boundWords(deadline)} ${ORIGIN_WORDS[deadline.origin]}${deadline.elapsedMs === undefined ? '' : `, ${elapsedWords(deadline.elapsedMs)} spent`}, life revision ${deadline.revision}`;

export const limitText = (answer: Answered<{ readonly outcome: CommandRevisionAnswer }>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  const { outcome } = answer;
  const by = `by host operation ${outcome.operation.operation}`;
  switch (outcome._tag) {
    case 'Revised':
      return `${refWords(outcome.deadline.execution)} life moved ${by}: ${deadlineWords(outcome.deadline)}`;
    case 'Stale':
      return `${refWords(outcome.deadline.execution)} not moved ${by} — the life changed since you read it; it now stands at ${deadlineWords(outcome.deadline)}`;
    case 'Refused':
      return `not moved ${by} — ${outcome.reason}: ${outcome.detail}`;
    case 'Ended': {
      const { decision } = outcome;
      const also = alsoWords(outcome.state.ref, [decision?.execution]);
      const decided =
        decision === undefined || decision.operation.operation === outcome.operation.operation
          ? ''
          : `; decided by host operation ${decision.operation.operation}`;
      return `${refWords(outcome.state.ref)} not moved ${by} — the command had already ended (${exitWords(outcome.state.nativeExit)})${also === '' ? '' : `; ${also}`}${decided}`;
    }
  }
};

const copiesOf = (reading: CommandReading): readonly (Addressed | undefined)[] => {
  const { wait, live } = reading;
  if (live._tag !== 'Held') return [wait?.execution];
  const { state, deadline, ending, usage } = live.entry;
  return [
    wait?.execution,
    state.ref,
    deadline.execution,
    ending?.execution,
    usage?.execution,
    ...(usage?.processes ?? []).map((row) => row.association?.execution),
  ];
};

const readingLine = (reading: CommandReading): string => {
  const { command, live } = reading;
  const also = alsoWords(command.execution, copiesOf(reading));
  const where = `${command.execution.execution}:${command.execution.incarnation}  ${whoWords(command)}${also === '' ? '' : `, ${also}`}`;
  const what = named(command);
  if (live._tag === 'Unheld') return `${where}  gone from the host  ${what}`;
  if (live._tag === 'Unavailable') return `${where}  host unreadable  ${what}`;
  const { state, deadline, ending, processes, pace } = live.entry;
  const ran = elapsedWords(deadline.elapsedMs);
  const paced = pace === undefined ? '' : `, pace ${pace}`;
  const bound = `${timeWords(deadline, command.time)}, life revision ${deadline.revision}${processWords(processes)}${paced}`;
  const standing =
    state.phase === 'ended'
      ? `ended, ${exitWords(ending?.nativeExit ?? state.nativeExit)}${ran === '' ? '' : ` after ${ran}`}, ${timeWords(deadline, command.time)}${processWords(processes)}${paced}`
      : state.phase === 'reserved' || state.phase === 'queued'
        ? `not yet started, ${bound}`
        : `running${ran === '' ? '' : ` for ${ran}`}, ${bound}`;
  return `${where}  ${standing}  ${what}`;
};

export const listingText = (answer: Answered<CommandListAnswer>): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  if (answer.readings.length === 0) return '(no commands)';
  const lines = answer.readings.map(readingLine);
  if (answer.after !== undefined) lines.push(`more remain — continue with after: ${answer.after}`);
  return lines.join('\n');
};

const usageWords = (usage: UsageReading): string => {
  const cpu = usage.cpu._tag === 'Measured' ? `cpu ${usage.cpu.cores.toFixed(2)} cores` : `cpu unknown — ${usage.cpu.detail}`;
  const memory =
    usage.memory._tag === 'ResidentSum'
      ? `${megabytes(usage.memory.bytes)} resident over ${usage.memory.processes} processes`
      : `memory unknown — ${usage.memory.detail}`;
  const over = usage.cpu._tag === 'Measured' && usage.cpu.basis === 'lifetime' ? 'over its life' : 'now';
  return `usage ${over}: ${cpu}; ${memory}${usage.completeness === 'complete' ? '' : `; the reading is ${usage.completeness}`}`;
};

const endingWords = (ending: EndingReceipt): string =>
  [
    `ending measured: ${exitWords(ending.nativeExit)}`,
    `cleanup ${ending.cleanup}`,
    costWords(ending.cost),
    ending.residual.length === 0 ? '' : `${ending.residual.length} resources survived`,
    ending.unverifiable.length === 0 ? '' : `${ending.unverifiable.length} not verified`,
    ending.abandonedOutput ? 'output abandoned' : '',
  ]
    .filter((part) => part !== '')
    .join(', ');

function whoWords(command: CommandReading['command']): string {
  const owner = subjectKeyOf(command.owner);
  const origin = command.origin._tag === 'Thread' ? `thread:${command.origin.thread}` : 'operator';
  return `owner ${owner}${origin === owner ? '' : `, started by ${origin}`}`;
}

const ownerWords = (command: CommandReading['command']): string => `${whoWords(command)}, admitted ${instantWords(command.admittedAt)}`;

const standingWords = (live: CommandReading['live']): string => {
  if (live._tag === 'Unheld') return 'gone from the host — a replaced generation or a retired record, never an ending';
  if (live._tag === 'Unavailable') return 'host unreadable, whether it runs is not known';
  const { state, deadline, ending } = live.entry;
  const ran = elapsedWords(deadline.elapsedMs);
  const standing =
    state.phase === 'ended'
      ? `ended, ${exitWords(ending?.nativeExit ?? state.nativeExit)}${ran === '' ? '' : ` after ${ran}`}`
      : state.phase === 'reserved' || state.phase === 'queued'
        ? 'accepted, not yet started'
        : `${state.phase}${ran === '' ? '' : ` for ${ran}`}`;
  return `${standing}, life revision ${deadline.revision}`;
};

function* commandLines(reading: CommandReading): Generator<string> {
  const { command, live, wait, current } = reading;
  yield `${refWords(command.execution)} ${standingWords(live)}${wait === undefined ? '' : `, observed in the ${wait.mode} under wait revision ${wait.revision}`}`;
  const also = alsoWords(command.execution, copiesOf(reading));
  if (also !== '') yield also;
  if (live._tag === 'Unavailable') yield live.detail;
  if (live._tag === 'Held') yield timeWords(live.entry.deadline, command.time);
  yield ownerWords(command);
  const place = [command.cwd, command.rootId === undefined ? undefined : `root ${command.rootId}`].filter((part) => part !== undefined);
  if (place.length > 0) yield place.join(', ');
  yield command.label !== undefined && command.commandLine !== undefined ? `${command.label} — ${command.commandLine}` : named(command);
  if (live._tag === 'Held') {
    const { ending, usage, processes, pace } = live.entry;
    if (ending !== undefined) yield endingWords(ending);
    if (usage !== undefined) yield usageWords(usage);
    const watched = processWords(processes).replace(/^, /u, '');
    if (watched !== '') yield watched;
    if (pace !== undefined) yield `pace ${pace}`;
  }
  if (current !== undefined)
    yield `current process pid ${current.identity.pid}${current.command === undefined ? '' : `: ${current.command}`}`;
}

export const commandVoice = (answer: Answered<CommandReading>) => (answer.status === 'ok' ? commandLines(answer) : UNVOICED);

export const commandWaitVoice = (answer: Answered<typeof CommandWaited.Type>, input: Addressed & { readonly waitMs: number }) =>
  answer.status === 'ok' ? waitLines(answer.waited, input, input.waitMs) : UNVOICED;
