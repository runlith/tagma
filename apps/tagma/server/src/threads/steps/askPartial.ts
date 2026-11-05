import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { Predicate } from 'effect';

const isPartial = (item: unknown): item is Readonly<Record<string, unknown>> => Predicate.isObject(item) && item.state === 'partial';

export const askPartialForm: ThreadFormStep = {
  name: '20261105180000_ask_partial',
  samples: {
    entry: {
      type: 'tool',
      id: 'tool:r:c',
      runId: 'r',
      toolName: 'ask',
      toolCallId: 'c',
      toolState: 'output-available',
      toolDisplay: {
        form: 'list',
        verb: 'Asked',
        title: '2 questions',
        items: [
          { label: 'first', detail: 'whole', state: 'answered' },
          { label: 'second', detail: 'in part', state: 'partial', thread: { id: 'reader' } },
        ],
      },
    },
  },
  entry: (entry) => {
    const display = entry.toolDisplay;
    if (entry.type !== 'tool' || !Predicate.isObject(display) || !Array.isArray(display.items)) return null;
    const items: readonly unknown[] = display.items;
    if (!items.some(isPartial)) return null;
    return {
      ...entry,
      toolDisplay: { ...display, items: items.map((item) => (isPartial(item) ? { ...item, state: 'answered' } : item)) },
    };
  },
};
