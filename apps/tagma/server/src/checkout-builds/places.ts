import { join } from 'node:path';

const BUILD_LOG = 'build.log';
const BUILD_RECORD = 'build.json';
const BUILD_WORKTREES = 'build';

export type BuildPlaces = { readonly log: string; readonly record: string; readonly worktrees: string };

export const buildPlaces = (dataPath: string): BuildPlaces => ({
  log: join(dataPath, BUILD_LOG),
  record: join(dataPath, BUILD_RECORD),
  worktrees: join(dataPath, BUILD_WORKTREES),
});
