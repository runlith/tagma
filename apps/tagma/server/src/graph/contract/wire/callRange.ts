import type { callJournalRangeSchema } from './answers.js';

export type CallJournalRange = typeof callJournalRangeSchema.Type;

export type JournalReading =
  | { readonly status: 'read'; readonly range: CallJournalRange | null }
  | { readonly status: 'unreadable'; readonly reason: string };

export type CallRecorded = {
  readonly status: 'ok';
  readonly landed: {
    readonly at: string;
    readonly acts: readonly { readonly op: string; readonly blockName: string | null }[];
  };
};
