import { Effect } from 'effect';
import type { SubjectPlace } from './contract/service/place.js';
import { cursorPlace } from './contract/wire/place.js';

export const PLATFORM_SUBJECTS: readonly SubjectPlace[] = [
  { kind: 'cursor', place: (cursor, operation) => Effect.succeed(cursorPlace(cursor, operation)) },
];
