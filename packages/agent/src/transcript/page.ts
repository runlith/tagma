import { Effect } from 'effect';
import type { ThreadTranscriptEntry, ThreadTranscriptPage } from './rows';

export function pageOpensOnTurnRoot(entries: readonly ThreadTranscriptEntry[]): boolean {
  for (const entry of entries) {
    if (entry.type === 'system-prompt') return true;
    if (entry.type !== 'message') continue;
    return (entry as { role?: string }).role === 'user';
  }
  return entries.length === 0;
}

export type PageWalkStop = 'turn-root' | 'start' | 'entry-budget' | 'byte-budget';

export type PageWalk = {
  readonly page: ThreadTranscriptPage;
  readonly pages: number;
  readonly stop: PageWalkStop;
};

export const extendPageToTurnRoot = Effect.fnUntraced(function* <E, R>(
  page: ThreadTranscriptPage,
  older: (before: number) => Effect.Effect<ThreadTranscriptPage, E, R>,
  budget: { readonly entries: number; readonly bytes: number },
): Effect.fn.Return<PageWalk, E, R> {
  let held = page;
  let entries = 0;
  let bytes = 0;
  let pages = 0;
  while (held.before !== null && !pageOpensOnTurnRoot(held.entries)) {
    if (entries >= budget.entries) return { page: held, pages, stop: 'entry-budget' };
    if (bytes >= budget.bytes) return { page: held, pages, stop: 'byte-budget' };
    const above = yield* older(held.before);
    pages += 1;
    if (above.entries.length === 0) return { page: { entries: held.entries, before: above.before }, pages, stop: 'start' };
    entries += above.entries.length;
    bytes += JSON.stringify(above.entries).length;
    held = { entries: [...above.entries, ...held.entries], before: above.before };
  }
  return { page: held, pages, stop: pageOpensOnTurnRoot(held.entries) ? 'turn-root' : 'start' };
});
