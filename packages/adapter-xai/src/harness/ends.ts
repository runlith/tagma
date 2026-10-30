import { dirname } from 'node:path';
import { answered, fieldsOf, textBlocks, type Fields, type TailEnd, type TailSource } from '@runlith/tagma/adapter/metadata';

const updateOf = (record: unknown): Fields | null => fieldsOf(fieldsOf(fieldsOf(record)?.params)?.update);

const OPENERS: ReadonlySet<unknown> = new Set(['user_message_chunk', 'tool_call', 'tool_call_update', 'agent_message_chunk']);

const finalMessage = (after: readonly unknown[], exhausted: boolean): string | null => {
  const chunks: string[] = [];
  for (const record of after) {
    const update = updateOf(record);
    if (update?.sessionUpdate === 'agent_message_chunk') chunks.push(textBlocks(fieldsOf(update.content)?.text));
    else if (update !== null && OPENERS.has(update.sessionUpdate)) return chunks.reverse().join('');
  }
  return exhausted ? chunks.reverse().join('') : null;
};

const judge = (newestFirst: readonly unknown[], exhausted: boolean): TailEnd | null => {
  for (const [at, record] of newestFirst.entries()) {
    const update = updateOf(record);
    if (update === null) continue;
    if (update.sessionUpdate === 'turn_completed') {
      if (update.stop_reason === 'cancelled') return { _tag: 'Aborted' };
      const message = finalMessage(newestFirst.slice(at + 1), exhausted);
      return message === null ? null : answered(message);
    }
    if (OPENERS.has(update.sessionUpdate)) return { _tag: 'Open' };
  }
  return null;
};

export const grokEnds: TailSource = {
  reader: {
    shape: 'lines',
    window: 'time',
    grain: 1000,
    stampOf: (record) => {
      const seconds = fieldsOf(record)?.timestamp;
      return typeof seconds === 'number' ? seconds * 1000 : null;
    },
    judge,
  },
  locate: (input) => (input.transcriptPath === undefined ? null : { root: dirname(input.transcriptPath), path: input.transcriptPath }),
  located: 'reported',
};
