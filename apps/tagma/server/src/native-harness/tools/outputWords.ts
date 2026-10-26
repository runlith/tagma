import type { ToolWords } from '@runlith/agent/tool/words';

export const RETRIEVAL_TOOL = 'read_tool_output';

export const RETRIEVAL_WORDS = {
  [RETRIEVAL_TOOL]: {
    running: 'Reading a retained answer',
    done: 'Read a retained answer',
    many: (count) => `Read ${count} retained answers`,
  },
} satisfies Record<string, ToolWords>;
