import { readFileSync } from 'node:fs';
import { serve } from '../worker.js';
import { readCookieText } from './read.js';

serve(
  (file: string) => readCookieText(readFileSync(file, 'utf8')),
  (cause) => ({
    message: `the cookie file could not be read: ${String(cause)}`,
    unblock: ['name a JSON file holding an array of cookies as browser extensions export them'],
  }),
);
