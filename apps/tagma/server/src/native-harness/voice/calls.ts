import { toolPageText } from '@runlith/agent/tool/page';
import type { CallRecord } from '@runlith/agent/callProgress';
import { elapsedWords } from '../../platform/contract/wire/text.js';
import { refusalLines } from '@runlith/agent/tool/refusal';

type Refused = {
  readonly status: 'refused';
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
};
type Answered<T> = ({ readonly status: 'ok' } & T) | Refused;

const refusedText = (answer: Refused): string => refusalLines(answer).join('\n');

const singleLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const compacted = (text: string, bound: number): string => (text.length <= bound ? text : `${text.slice(0, bound)}…`);

const inputWords = (input: unknown): string => {
  const printed = singleLine(typeof input === 'string' ? input : (JSON.stringify(input) ?? 'unprintable'));
  return `input: ${compacted(printed, 200)}`;
};

const executionsWords = (executions: CallRecord['executions']): string => {
  if (executions.length === 0) return '';
  const listed = executions.map(({ execution, operation, label }, at) => {
    const address = `${execution.execution}:${execution.incarnation} by operation ${operation.operation}`;
    return at < 2 ? `${address} ${compacted(singleLine(label), 40)}` : address;
  });
  return `${executions.length} ${executions.length === 1 ? 'execution' : 'executions'}: ${listed.join(', ')}`;
};

export const callLine = (record: CallRecord): string => {
  const ran = record.endedAt === null ? Date.now() - record.startedAt : record.endedAt - record.startedAt;
  const parts = [
    `${record.runId} ${record.toolCallId}`,
    record.threadId ?? 'operator',
    record.name,
    `${record.phase} ${record.mode} ${elapsedWords(ran)}`,
    inputWords(record.input),
    ...(record.detail === null ? [] : [compacted(singleLine(record.detail), 160)]),
    executionsWords(record.executions),
  ].filter((part) => part !== '');
  return parts.join('  ');
};

export const callsText = (
  answer: Answered<{ readonly calls: readonly CallRecord[]; readonly total: number; readonly next: string | null }>,
): string => {
  if (answer.status !== 'ok') return refusedText(answer);
  return toolPageText({
    rows: answer.calls.map((record) => ({ label: callLine(record) })),
    total: answer.total,
    order: 'standing first, newest first',
    next: answer.next === null ? undefined : `read_calls(cursor="${answer.next}")`,
    empty: 'no invocations held',
  });
};
