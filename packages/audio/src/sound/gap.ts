import { Schema } from 'effect';

export const GapCause = Schema.Literals([
  'overflow',
  'device-change',
  'device-lost',
  'helper-failed',
  'transport',
  'recognition-failed',
  'unconfirmed-tail',
  'reconnect',
  'handoff',
  'budget',
]);
export type GapCause = Schema.Schema.Type<typeof GapCause>;

const LOST: Readonly<Record<GapCause, string>> = {
  overflow: 'part of the sound was dropped because it was not read in time',
  'device-change': 'the input device changed and part of the sound was lost',
  'device-lost': 'the input device stopped and part of the sound was lost',
  'helper-failed': 'the audio helper stopped and part of the sound was lost',
  transport: 'part of the sound did not arrive',
  'recognition-failed': 'recognition failed for part of the sound',
  'unconfirmed-tail': 'the recognizer did not confirm the end of the sound',
  reconnect: 'part of the sound was not recognized while the recognizer reconnected',
  handoff: 'part of the sound was lost while the recording moved to a new server process',
  budget: 'part of the sound was dropped because the recognizer fell behind',
};

export const lostSound = (cause: GapCause): string => LOST[cause];

export type Gap = {
  readonly _tag: 'Gap';
  readonly from: bigint;
  readonly to: bigint | undefined;
  readonly cause: GapCause;
};

export const gap = (from: bigint, to: bigint | undefined, cause: GapCause): Gap => ({ _tag: 'Gap', from, to, cause });
