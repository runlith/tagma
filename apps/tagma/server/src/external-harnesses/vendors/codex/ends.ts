import { dirname } from 'node:path';
import { answered, fieldsOf, isoStamp, textOf, type TailEnd, type TailSource } from '../../ends/tail.js';
import { codexFailureOf } from './failure.js';

const completed = (event: Readonly<Record<string, unknown>>): TailEnd => {
  const error = fieldsOf(event.error);
  if (error === null) return answered(textOf(event.last_agent_message) ?? '');
  const cause = codexFailureOf(error.codex_error_info);
  const reason = textOf(error.message) ?? 'Codex ended the turn with an error';
  return cause === null ? { _tag: 'Failed', reason } : { _tag: 'Failed', reason, cause };
};

const judge = (newestFirst: readonly unknown[], _exhausted: boolean, turn: string | null): TailEnd | null => {
  for (const record of newestFirst) {
    const entry = fieldsOf(record);
    if (entry === null || entry.type !== 'event_msg') continue;
    const event = fieldsOf(entry.payload);
    const named = textOf(event?.turn_id);
    if (turn !== null && named !== null && named !== turn) continue;
    if (event?.type === 'task_complete') return completed(event);
    if (event?.type === 'turn_aborted') return { _tag: 'Aborted' };
    if (event?.type === 'task_started') return { _tag: 'Open' };
  }
  return null;
};

export const codexEnds: TailSource = {
  reader: { shape: 'lines', window: 'time', grain: 1, stampOf: (record) => isoStamp(fieldsOf(record)?.timestamp), judge },
  locate: (input) => (input.transcriptPath === undefined ? null : { root: dirname(input.transcriptPath), path: input.transcriptPath }),
  located: 'reported',
};
