import type { ThreadEntry } from './entries';
import type { ThreadRewindMark } from './eventFold';

export type ThreadProductEntry = {
  readonly type: string;
  readonly id: string;
  readonly runId?: string;
  readonly occurredAt?: string;
  readonly rewound?: ThreadRewindMark;
};
export type ThreadTranscriptEntry = ThreadEntry | ThreadProductEntry;
export type ThreadTranscript = readonly ThreadTranscriptEntry[];

export type ThreadTranscriptPage = {
  readonly entries: ThreadTranscript;
  readonly before: number | null;
};
