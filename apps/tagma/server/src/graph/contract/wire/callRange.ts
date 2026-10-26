export type CallJournalRange = {
  readonly from: number;
  readonly to: number;
  readonly chars?: { readonly from: number; readonly to: number };
};

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
