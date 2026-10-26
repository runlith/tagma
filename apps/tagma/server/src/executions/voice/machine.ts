import type { MachineMemory } from '@runlith/executions/protocol/evidence';
import { UNVOICED } from '../../platform/contract/service/presentation.js';
import { elapsedWords } from '../../platform/contract/wire/text.js';
import type { LoadProcess, LoadTotal } from '../contract/wire/load.js';
import type { MachineReport, MachineRow } from '../contract/wire/operations/machine.js';
import { type Answered, instantWords, megabytes, refWords } from './execution.js';

type Read = Extract<MachineReport, { readonly _tag: 'Read' }>;

const percent = (share: number | null): string => (share === null ? 'unmeasured' : `${(share * 100).toFixed(1)}%`);

const sizeWords = (bytes: number | null): string =>
  bytes === null ? 'memory unread' : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : megabytes(bytes);

const memoryWords = (memory: MachineMemory): string =>
  memory._tag === 'Unknown'
    ? `memory unknown — ${memory.detail}`
    : `memory ${sizeWords(memory.usedBytes)} used of ${sizeWords(memory.totalBytes)}, ${sizeWords(memory.availableBytes)} available${
        memory.pressure._tag === 'Measured' ? `, pressure ${memory.pressure.level}` : ''
      }`;

const totalWords = (name: string, total: LoadTotal): string =>
  `${name} ${percent(total.share)} · ${sizeWords(total.memoryBytes)} in ${total.count} rows${total.unread === 0 ? '' : `, ${total.unread} processes unread`}`;

const shareWords = (process: LoadProcess): string =>
  process.share === null || process.reapedShare === undefined || process.reapedShare === 0
    ? percent(process.share)
    : `${percent(process.share)} (own ${percent(process.share - process.reapedShare)}, children it reaped ${percent(process.reapedShare)})`;

const processLine = (process: LoadProcess): string =>
  `    pid ${process.pid} ${shareWords(process)} · ${sizeWords(process.memoryBytes)}${process.killable ? '' : ' · not killable'}  ${
    process.role === undefined ? '' : `${process.role}: `
  }${(process.command ?? process.name).replace(/\s*\n\s*/gu, ' ⏎ ')}${process.unread === undefined ? '' : ` (unread: ${process.unread})`}`;

function* rowLines(row: MachineRow): Generator<string> {
  const where = [
    row.thread === undefined ? undefined : `thread ${row.thread}`,
    row.project === undefined ? undefined : `project ${row.project.name}`,
  ].filter((part) => part !== undefined);
  yield `- ${percent(row.share)} · ${sizeWords(row.memoryBytes)}  ${row.kind} ${row.title}${row.detail === undefined ? '' : ` — ${row.detail}`}${
    where.length === 0 ? '' : ` · ${where.join(' · ')}`
  }${row.unread === 0 ? '' : ` · ${row.unread} processes unread`}`;
  for (const execution of row.work?.executions ?? []) {
    yield `    ${execution.kind} ${refWords(execution.execution)} ${execution.transport}${execution.session ? ' (its harness session)' : ''} ${percent(
      execution.share,
    )} · ${sizeWords(execution.memoryBytes)}  ${execution.label}`;
  }
  for (const residual of row.work?.residuals ?? []) yield `    left running: pid ${residual.pid} from ${refWords(residual.origin)}`;
  for (const process of row.processes) yield processLine(process);
  if (row.more > 0) yield `    … ${row.more} more processes`;
}

function* readLines(report: Read, shown: number): Generator<string> {
  yield `machine ${report.cores} cores, ${percent(report.share)} busy${report.saturated ? ', saturated' : ''}; ${memoryWords(report.memory)}`;
  const { totals } = report;
  yield `${totalWords('Tagma', totals.own)}; ${totalWords('agents', totals.agent)}; ${totalWords('work', totals.work)}`;
  yield `${totalWords('outside', totals.outside)}, of them folded ${totalWords('small rows', totals.others)}`;
  if (report.unread !== undefined) yield `unread: ${report.unread}`;
  if (report.top !== undefined) yield `heaviest of Tagma: ${report.top.title} ${percent(report.top.share)} (${report.top.key})`;
  for (const work of report.background) {
    yield `background: ${work.title} — ${work.reason}, ${work.done}${work.total === null ? '' : ` of ${work.total}`} done${
      work.remainingMs === null ? '' : `, about ${elapsedWords(work.remainingMs)} left`
    }`;
  }
  yield `${shown} of ${report.total} rows, heaviest first:`;
  for (const row of report.rows) yield* rowLines(row);
}

function* reportLines(state: MachineReport, shown: number): Generator<string> {
  switch (state._tag) {
    case 'Read':
      yield* readLines(state, shown);
      return;
    case 'Waiting':
      yield 'machine load not read yet: the first interval has not closed';
      return;
    case 'Lost':
      yield `machine load lost since ${instantWords(state.since)}: ${state.reason}`;
      return;
    case 'Outdated':
      yield `machine load outdated: ${state.reason}`;
  }
}

export const machineVoice = (answer: Answered<{ readonly state: MachineReport; readonly shown: number }>) =>
  answer.status === 'ok' ? reportLines(answer.state, answer.shown) : UNVOICED;
