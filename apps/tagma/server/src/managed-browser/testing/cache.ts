import { homedir } from 'node:os';
import { join } from 'node:path';

export const TEST_BUILDS = process.env.TAGMA_BROWSER_BUILDS ?? join(homedir(), '.cache', 'runlith', 'browser-builds');

export const FILL_CACHE = 'bun apps/tagma/server/scripts/fetch-browser.ts';
