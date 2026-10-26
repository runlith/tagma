import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import {
  type Relocated,
  type Relocation,
  RelocationFailed,
  type RelocationMiss,
  relocatedPath,
  relocatedText,
} from '../../platform/contract/service/relocation.js';
import { TREE_MERGES as MERGES, TREE_ORIGINS as ORIGINS, TREE_SERVED as SERVED } from '../contract/wire/storage.js';
import { graphHome, MIRROR_FILES, mirrorPath, legacyHome, stealthTreeName } from './layout.js';

const GRAPH_GIT = 'graph.git';
const TREES = 'trees';

const keyOf = (root: string): string => Bun.hash(root).toString(16);

const entries = (directory: string): readonly string[] => (existsSync(directory) ? readdirSync(directory) : []);

const readText = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

const moveFile = (from: string, to: string): void => {
  if (from === to || !existsSync(from)) return;
  if (!existsSync(to)) renameSync(from, to);
  else rmSync(from, { recursive: true, force: true });
};

const rewrite = (path: string, places: readonly Relocated[]): void => {
  const text = readText(path);
  if (text === null) return;
  const moved = relocatedText(text, places);
  if (moved !== text) writeFileSync(path, moved);
};

const treeMoved = (
  data: Relocated,
  project: string,
  tree: string,
  places: readonly Relocated[],
): { readonly root: string; readonly misses: readonly RelocationMiss[] } => {
  const gitDir = join(graphHome(data.to, project), GRAPH_GIT);
  const standing = join(graphHome(data.to, project), TREES, tree);
  const former = join(graphHome(data.from, project), TREES, tree);
  const served = readText(join(gitDir, SERVED, keyOf(former)));
  const servedNow = served === null ? null : (relocatedPath(served, places) ?? served);
  const root = servedNow === null || servedNow === served ? standing : join(graphHome(data.to, project), TREES, stealthTreeName(servedNow));
  if (root !== standing && existsSync(root)) {
    return { root: standing, misses: [{ path: root, detail: `${standing} cannot take its name: it stands` }] };
  }
  for (const kind of [ORIGINS, SERVED]) {
    const value = readText(join(gitDir, kind, keyOf(former)));
    if (value !== null) writeFileSync(join(gitDir, kind, keyOf(root)), relocatedPath(value, places) ?? value);
  }
  const merge = join(gitDir, MERGES, `${keyOf(former)}.json`);
  if (existsSync(merge)) {
    rewrite(merge, places);
    moveFile(merge, join(gitDir, MERGES, `${keyOf(root)}.json`));
  }
  for (const ending of MIRROR_FILES) {
    moveFile(`${mirrorPath(data.to, project, former)}${ending}`, `${mirrorPath(data.to, project, root)}${ending}`);
  }
  if (root !== standing) renameSync(standing, root);
  for (const kind of [ORIGINS, SERVED]) {
    const left = join(gitDir, kind, keyOf(former));
    if (keyOf(former) !== keyOf(root)) rmSync(left, { force: true });
  }
  return { root, misses: [] };
};

const repaired = (gitDir: string, roots: readonly string[]): readonly RelocationMiss[] => {
  if (roots.length === 0) return [];
  const ran = Bun.spawnSync(['git', '--git-dir', gitDir, 'worktree', 'repair', ...roots], { stdout: 'pipe', stderr: 'pipe' });
  return ran.exitCode === 0 ? [] : [{ path: gitDir, detail: `git worktree repair: ${ran.stderr.toString().trim()}` }];
};

const storageMoved = (data: Relocated, project: string, places: readonly Relocated[]): readonly RelocationMiss[] => {
  const gitDir = join(graphHome(data.to, project), GRAPH_GIT);
  const misses: RelocationMiss[] = [];
  const roots: string[] = [];
  for (const tree of entries(join(graphHome(data.to, project), TREES))) {
    if (!statSync(join(graphHome(data.to, project), TREES, tree)).isDirectory()) continue;
    const moved = treeMoved(data, project, tree, places);
    misses.push(...moved.misses);
    rewrite(join(moved.root, '.git'), places);
    roots.push(moved.root);
  }
  rewrite(join(gitDir, 'config'), places);
  for (const worktree of entries(join(gitDir, 'worktrees'))) rewrite(join(gitDir, 'worktrees', worktree, 'gitdir'), places);
  misses.push(...repaired(gitDir, roots));
  return misses;
};

const legacyMoved = (data: Relocated): void => {
  const home = legacyHome(data.to);
  for (const project of entries(home)) {
    const former = join(legacyHome(data.from), project);
    for (const ending of MIRROR_FILES) {
      moveFile(`${mirrorPath(data.to, project, former)}${ending}`, `${mirrorPath(data.to, project, join(home, project))}${ending}`);
    }
  }
};

export const graphRelocation: Relocation = {
  id: 'graph/storage',
  beside: (data) => [{ from: legacyHome(data.from), to: legacyHome(data.to) }],
  carried: (data) => [legacyHome(data), join(data, 'graphs')],
  relocate: (data, places) =>
    Effect.try({
      try: () => {
        legacyMoved(data);
        return entries(join(data.to, 'graphs'))
          .filter((project) => existsSync(join(graphHome(data.to, project), GRAPH_GIT, 'HEAD')))
          .flatMap((project) => storageMoved(data, project, places));
      },
      catch: (cause) => new RelocationFailed({ detail: String(cause) }),
    }),
};
