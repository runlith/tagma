import { dirname } from 'node:path';
import { answered, fieldsOf, isoStamp, textOf, type TailEnd, type TailSource } from '../../ends/tail.js';

const judge = (newestFirst: readonly unknown[]): TailEnd | null => {
  for (const record of newestFirst) {
    const entry = fieldsOf(record);
    if (entry === null || entry.type !== 'event_msg') continue;
    const event = fieldsOf(entry.payload);
    if (event?.type === 'task_complete') return answered(textOf(event.last_agent_message) ?? '');
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
