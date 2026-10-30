import { dirname } from 'node:path';
import { answered, blocksOf, fieldsOf, textBlocks, textOf, type TailEnd, type TailSource } from '@runlith/tagma/adapter/metadata';

const lastAnswer = (after: readonly unknown[]): string => {
  for (const record of after) {
    const entry = fieldsOf(record);
    if (entry?.role !== 'assistant') continue;
    return textBlocks(fieldsOf(entry.message)?.content);
  }
  return '';
};

const judge = (newestFirst: readonly unknown[]): TailEnd | null => {
  for (const [at, record] of newestFirst.entries()) {
    const entry = fieldsOf(record);
    if (entry === null) continue;
    if (entry.type === 'turn_ended') {
      if (entry.status === 'aborted') return { _tag: 'Aborted' };
      if (entry.status === 'success') return answered(lastAnswer(newestFirst.slice(at + 1)));
      return { _tag: 'Failed', reason: textOf(entry.error) ?? textOf(entry.status) ?? 'turn ended' };
    }
    if (entry.role === 'assistant') {
      const content = fieldsOf(entry.message)?.content;
      return blocksOf(content).some((block) => block.type === 'tool_use') ? { _tag: 'Open' } : answered(textBlocks(content));
    }
    if (entry.role === 'user') return { _tag: 'Open' };
  }
  return null;
};

export const cursorEnds: TailSource = {
  reader: { shape: 'lines', window: 'offset', grain: 1, stampOf: () => null, judge },
  locate: (input) => (input.transcriptPath === undefined ? null : { root: dirname(input.transcriptPath), path: input.transcriptPath }),
  located: 'reported',
};
