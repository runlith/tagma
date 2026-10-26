import type { Effect } from 'effect';
import type { Reading } from '../cookie.js';
import type { SourceUnreadable } from '../source.js';
import { offLoop } from '../worker.js';

const WORKER = new URL('./file.worker.ts', import.meta.url);

export const readCookieFile = (file: string): Effect.Effect<Reading, SourceUnreadable> =>
  offLoop<string, Reading>(WORKER, file, `the cookie file ${file}`);
