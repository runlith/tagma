import type { Words } from './refusal.js';

export type VoiceRefused = {
  readonly status: 'refused';
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
  readonly words?: Words;
  readonly field?: string;
};

export type VoiceAck = {
  readonly status: 'ok';
};
