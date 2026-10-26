import type { WarmthSubject } from '../contract/wire/warmth.js';
import type { NativeThreadState } from '../contract/service/state.js';

export const warmthProviders = (threads: readonly WarmthSubject[]): readonly string[] => [
  ...new Set(threads.flatMap((thread) => (thread.contextReading === null ? [] : [thread.provider]))),
];

export function restingThreads(state: NativeThreadState): readonly WarmthSubject[] {
  return state.activeRun === null ? [state.thread] : [];
}
