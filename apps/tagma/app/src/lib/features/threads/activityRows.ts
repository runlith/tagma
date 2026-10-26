import type { CallRecord } from '@runlith/agent/callProgress';
import { isQueued, type ProcessLine } from '../executions/processes/lines.js';
import { terminalKey } from '../executions/Repo.js';

export type ActivityExecution = {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly line: ProcessLine | null;
};

export type ActivityState = 'active' | 'unknown' | 'recent';

export type ActivityRow = {
  readonly key: string;
  readonly call: CallRecord | null;
  readonly executions: readonly ActivityExecution[];
  readonly state: ActivityState;
  readonly title: string;
  readonly subject: string | null;
  readonly status: string;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
};

export function isRunning(line: ProcessLine): boolean {
  return line.live === 'held' && line.phase !== null && line.phase !== 'ended';
}

export function isUnknown(line: ProcessLine): boolean {
  return line.live === 'unavailable';
}

const SUBJECT_KEYS = [
  'description',
  'command',
  'pattern',
  'query',
  'url',
  'task',
  'path',
  'filePath',
  'file_path',
  'name',
  'text',
  'prompt',
  'id',
] as const;
function subjectOf(call: CallRecord): string | null {
  if (typeof call.input !== 'object' || call.input === null) return null;
  const fields = call.input as Record<string, unknown>;
  for (const key of SUBJECT_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) return value.join(', ');
  }
  return null;
}

function processStatus(line: ProcessLine): string {
  if (line.live === 'unheld') return 'No longer held';
  if (isUnknown(line)) return 'State unavailable';
  if (line.phase === 'ended') return line.unstarted === null ? 'Finished' : 'Not started';
  if (isQueued(line)) return 'Queued';
  if (line.phase === 'stopping') return 'Stopping';
  if (line.phase === 'starting') return 'Starting';
  return line.outer ? 'CLI session' : line.wait === 'background' ? 'Background' : 'Running';
}

export function callStatus(call: CallRecord, running: number, unknown: number): string {
  if (call.endedAt === null) {
    if (call.phase === 'preparing') return 'Preparing';
    if (call.phase === 'waiting') return 'Waiting';
    if (call.phase === 'stopping') return 'Stopping';
    return call.mode === 'background' ? 'Background' : 'Running';
  }
  if (running > 0) return 'Process still active';
  if (unknown > 0) return 'Process state unavailable';
  return call.phase === 'completed'
    ? 'Finished'
    : call.phase === 'stopped'
      ? 'Stopped'
      : call.phase === 'unavailable'
        ? 'Unavailable'
        : call.phase === 'interrupted'
          ? 'Interrupted'
          : 'Failed';
}

export function linksOf(calls: readonly CallRecord[]): readonly string[] {
  return calls.flatMap((call) => call.executions.map((execution) => terminalKey(execution.execution)));
}

export function activityRows(threadId: string, calls: readonly CallRecord[], lines: readonly ProcessLine[]): readonly ActivityRow[] {
  const processes = new Map(lines.map((line) => [line.key, line]));
  const linked = new Set<string>();
  const rows: ActivityRow[] = [];
  for (const call of calls) {
    if (call.threadId !== threadId) continue;
    const executions = new Map<string, ActivityExecution>();
    for (const execution of call.executions) {
      const key = terminalKey(execution.execution);
      linked.add(key);
      executions.set(key, { key, label: execution.label, kind: execution.kind, line: processes.get(key) ?? null });
    }
    const held = [...executions.values()];
    const running = held.filter(({ line }) => line !== null && isRunning(line)).length;
    const unknown = held.filter(({ line }) => line !== null && isUnknown(line)).length;
    const state: ActivityState = call.endedAt === null || running > 0 ? 'active' : unknown > 0 ? 'unknown' : 'recent';
    rows.push({
      key: `call:${JSON.stringify([call.runId, call.toolCallId])}`,
      call,
      executions: held,
      state,
      title: call.name,
      subject: subjectOf(call) ?? held[0]?.label ?? null,
      status: callStatus(call, running, unknown),
      startedAt: call.startedAt,
      endedAt: running > 0 ? null : call.endedAt,
    });
  }
  for (const [key, line] of processes) {
    if (line.owner.thread !== threadId || linked.has(key)) continue;
    rows.push({
      key: `process:${key}`,
      call: null,
      executions: [{ key, label: line.label ?? line.command ?? line.kind, kind: line.kind, line }],
      state: isRunning(line) ? 'active' : isUnknown(line) ? 'unknown' : 'recent',
      title: line.outer ? 'CLI session' : line.kind === 'terminal' ? 'Terminal' : 'Command',
      subject: line.label ?? line.command,
      status: processStatus(line),
      startedAt: line.startedAt,
      endedAt: line.endedAt,
    });
  }
  const rank = (state: ActivityState): number => (state === 'active' ? 0 : state === 'unknown' ? 1 : 2);
  return rows.sort(
    (a, b) =>
      rank(a.state) - rank(b.state) ||
      (a.state === 'active'
        ? (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity)
        : (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0)),
  );
}
