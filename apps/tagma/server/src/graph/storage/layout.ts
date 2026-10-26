import { basename, dirname, join } from 'node:path';
import { Data, Effect, FileSystem } from 'effect';
import { CHECKOUT_DIRECTORY } from '../contract/wire/storage.js';
import type { StorageMode } from '../../projects/contract/wire/project.js';
import { storeDirectory } from '../../platform/contract/service/store.js';

export type StorageLayout =
  | {
      readonly mode: 'stealth';
      readonly treeRoot: string;
      readonly gitDir: string;
      readonly mirrorPath: string;
    }
  | {
      readonly mode: 'team';
      readonly treeRoot: string;
      readonly mirrorPath: string;
    };

export class StorageLayoutInvalid extends Data.TaggedError('StorageLayoutInvalid')<{
  readonly message: string;
}> {}

export type StorageLayoutInput = {
  readonly mode: StorageMode;
  readonly projectId: number;
  readonly appHome: string;
  readonly worktree?: string;
};

export function storageHomes(storePath: string): { appHome: string } {
  return { appHome: storeDirectory(storePath) };
}

export const MIRROR_FILES = ['', '-wal', '-shm', '.snapshot.json', '.snapshots', '.watch-0', '.watch-1', '.watch-2'] as const;

export const removeMirror = Effect.fn('Mirrors.remove')(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  for (const ending of MIRROR_FILES) yield* files.remove(`${path}${ending}`, { recursive: true, force: true });
}, Effect.uninterruptible);

export const mirrorsHome = (appHome: string): string => join(appHome, 'mirror');

export const graphsHome = (appHome: string): string => join(appHome, 'graphs');

export const mirrorHome = (appHome: string, projectId: number): string => join(mirrorsHome(appHome), String(projectId));

export const mirrorFile = (home: string, treeRoot: string): string => join(home, `${Bun.hash(treeRoot).toString(16)}.sqlite`);

export const mirrorPath = (appHome: string, projectId: number, treeRoot: string): string =>
  mirrorFile(mirrorHome(appHome, projectId), treeRoot);

export const stealthTreeName = (worktree: string): string => `${basename(worktree)}-${Bun.hash(worktree).toString(16)}`;

export const graphHome = (appHome: string, projectId: number): string => join(graphsHome(appHome), String(projectId));

const setAsideStamp = (at: Date): string => at.toISOString().slice(0, 19).replaceAll(/[-:]/g, '').replace('T', '-');

export const setAsideHome = (appHome: string, projectId: number, at: Date): string =>
  join(appHome, 'set-aside', `${projectId}-${setAsideStamp(at)}`);

export const legacyHome = (appHome: string): string => {
  const name = basename(appHome);
  return join(dirname(appHome), name.length > 1 && name.startsWith('.') ? name.slice(1) : 'tagma');
};

export function resolveStorageLayout(input: StorageLayoutInput): Effect.Effect<StorageLayout, StorageLayoutInvalid> {
  if (input.worktree === undefined) {
    return Effect.fail(new StorageLayoutInvalid({ message: `${input.mode} storage resolves against a checkout, and none was named` }));
  }
  if (input.mode === 'team') {
    const treeRoot = join(input.worktree, CHECKOUT_DIRECTORY);
    return Effect.succeed({
      mode: input.mode,
      treeRoot,
      mirrorPath: mirrorPath(input.appHome, input.projectId, treeRoot),
    });
  }
  const home = graphHome(input.appHome, input.projectId);
  const treeRoot = join(home, 'trees', stealthTreeName(input.worktree));
  return Effect.succeed({
    mode: input.mode,
    treeRoot,
    gitDir: join(home, 'graph.git'),
    mirrorPath: mirrorPath(input.appHome, input.projectId, treeRoot),
  });
}
