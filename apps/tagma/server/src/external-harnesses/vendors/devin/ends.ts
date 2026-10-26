import { dirname, join } from 'node:path';
import { storageHome } from '../../metadata/sources.js';
import { answered, fieldsOf, isoStamp, textBlocks, type TailEnd, type TailSource } from '../../ends/tail.js';

const INTERRUPTED = '[Response interrupted by user]';

const judge = (newestFirst: readonly unknown[]): TailEnd | null => {
  for (const record of newestFirst) {
    const step = fieldsOf(record);
    if (step === null) continue;
    if (step.source === 'system') {
      if (textBlocks(step.message).startsWith(INTERRUPTED)) return { _tag: 'Aborted' };
      continue;
    }
    if (step.source === 'user') return { _tag: 'Open' };
    if (step.source === 'agent') {
      const calling = Array.isArray(step.tool_calls) && step.tool_calls.length > 0;
      return calling ? { _tag: 'Open' } : answered(textBlocks(step.message));
    }
  }
  return null;
};

export const devinEnds: TailSource = {
  reader: {
    shape: 'document',
    window: 'time',
    grain: 1,
    stampOf: (record) => isoStamp(fieldsOf(record)?.timestamp),
    records: (document) => {
      const steps = fieldsOf(document)?.steps;
      return Array.isArray(steps) ? steps : [];
    },
    judge,
  },
  locate: (input) => {
    const data = storageHome(input, 'XDG_DATA_HOME', '.local/share');
    if (data === null) return null;
    const path = join(data, 'devin', 'cli', 'transcripts', `${input.rootKey}.json`);
    return { root: dirname(path), path };
  },
  located: 'reported',
};
