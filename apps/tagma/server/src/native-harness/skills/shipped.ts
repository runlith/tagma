import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const installed = fileURLToPath(new URL('../../skills/', import.meta.url));

export const SHIPPED_SKILLS = existsSync(installed) ? installed : fileURLToPath(new URL('./', import.meta.url));
