import { Effect } from 'effect';
import { SearchUncounted } from '../contract/service/acts.js';
import { askOnce } from '../tree/oneShot.js';
import { type SearchRow, type SearchSubject, searchRowsOf } from './words.js';

export type CountAnswer =
  | { readonly state: 'counted'; readonly rows: readonly SearchRow[] }
  | { readonly state: 'failed'; readonly message: string };

const LOOP_TEXT = 30_000;

const askWorker = (subjects: readonly SearchSubject[]) =>
  askOnce<CountAnswer, SearchUncounted>(
    new URL('./counting.worker.ts', import.meta.url),
    subjects,
    (message) => new SearchUncounted({ message }),
  );

export const countSearch = Effect.fn('Search.count')(function* (subjects: readonly SearchSubject[]) {
  const text = subjects.reduce((sum, row) => sum + row.title.length + row.body.length + row.sourceRefs.join(' ').length, 0);
  if (text <= LOOP_TEXT) return searchRowsOf(subjects);
  const answer = yield* askWorker(subjects);
  if (answer.state === 'failed') return yield* new SearchUncounted({ message: answer.message });
  return answer.rows;
});
