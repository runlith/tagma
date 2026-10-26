import { answered, fieldsOf, isoStamp, textBlocks, type TailEnd, type TailSource } from '../../ends/tail.js';
import { claudeTranscript } from './metadata.js';

const INTERRUPTED = '[Request interrupted by user';
const FINAL_REASONS: ReadonlySet<unknown> = new Set(['end_turn', 'stop_sequence']);

const judge = (newestFirst: readonly unknown[]): TailEnd | null => {
  for (const record of newestFirst) {
    const entry = fieldsOf(record);
    if (entry === null || entry.isSidechain === true) continue;
    const message = fieldsOf(entry.message);
    if (entry.type === 'user') {
      return textBlocks(message?.content).startsWith(INTERRUPTED) ? { _tag: 'Aborted' } : { _tag: 'Open' };
    }
    if (entry.type === 'assistant') {
      return FINAL_REASONS.has(message?.stop_reason) ? answered(textBlocks(message?.content)) : { _tag: 'Open' };
    }
  }
  return null;
};

export const claudeEnds: TailSource = {
  reader: { shape: 'lines', window: 'time', grain: 1, stampOf: (record) => isoStamp(fieldsOf(record)?.timestamp), judge },
  locate: claudeTranscript,
  located: 'launch',
};
