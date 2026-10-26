import type { ThreadRunStoppedBy, ThreadStopAnswer, ThreadStopDoor } from '../ending';

export type RunNote =
  | { readonly type: 'question-asked'; readonly question: string; readonly toolCalls: readonly string[] }
  | { readonly type: 'question-answered'; readonly question: string; readonly outcome: 'answered' | 'cleared' }
  | { readonly type: 'context-requested'; readonly request: string; readonly fromGeneration: number }
  | {
      readonly type: 'context-settled';
      readonly request: string;
      readonly outcome: string;
      readonly generation: number;
    }
  | { readonly type: 'signals-read'; readonly signals: readonly string[] }
  | { readonly type: 'host-stopping' }
  | { readonly type: 'swept'; readonly failure?: string }
  | {
      readonly type: 'stop';
      readonly door: ThreadStopDoor;
      readonly by: ThreadRunStoppedBy;
      readonly expected: string | null;
      readonly outcome: ThreadStopAnswer['status'] | 'failed';
      readonly failure?: string;
    }
  | { readonly type: 'settled'; readonly outcome: 'failed' | 'aborted' | 'withdrawn'; readonly failure?: string }
  | { readonly type: 'cut'; readonly afterMs: number }
  | { readonly type: 'reap-declined'; readonly afterMs: number }
  | { readonly type: 'reaped'; readonly cause: string; readonly reason: string; readonly afterMs: number }
  | { readonly type: 'adopted'; readonly afterMs: number }
  | { readonly type: 'ownership-lost'; readonly afterMs: number }
  | { readonly type: 'resume-failed'; readonly failure: string }
  | { readonly type: 'dropped'; readonly failure: string }
  | { readonly type: 'notification-exhausted'; readonly attempts: number; readonly delivered: readonly string[] };
