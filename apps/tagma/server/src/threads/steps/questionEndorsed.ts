import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';

export const questionEndorsedForm: ThreadFormStep = {
  name: '20261022170000_question_endorsed',
  samples: {
    entry: {
      type: 'question',
      id: 'q',
      runId: 'r',
      questionId: 'q',
      questions: [],
      toolCalls: [],
      status: 'open',
      approver: 'grandparent',
      endorsed: ['parent'],
    },
  },
  entry: (entry) => {
    if (entry.type !== 'question' || !('endorsed' in entry)) return null;
    const { endorsed: _endorsed, approver: _approver, ...rest } = entry;
    return rest;
  },
};
