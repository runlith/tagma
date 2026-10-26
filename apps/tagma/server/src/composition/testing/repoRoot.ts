import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..');
export const SERVER_SRC = join(import.meta.dir, '..', '..');
export const EXECUTION_HOST_ROOT = join(REPO_ROOT, 'packages', 'execution-host');
