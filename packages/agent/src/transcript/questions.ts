import type { ThreadQuestionEntry } from './entries';
import type { ThreadTranscript } from './rows';

export const openQuestionsIn = (entries: ThreadTranscript): readonly ThreadQuestionEntry[] =>
  entries
    .filter((entry): entry is ThreadQuestionEntry & typeof entry => entry.type === 'question')
    .filter((entry) => entry.status === 'open');
