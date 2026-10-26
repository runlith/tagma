import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { type Relocation, RelocationFailed, type RelocationMiss } from '../platform/contract/service/relocation.js';
import { WORKTREE_HOME } from './contract/service/home.js';

const entries = (directory: string): readonly string[] => (existsSync(directory) ? readdirSync(directory) : []);

const repositoryOf = (worktree: string): string | null => {
  const marker = join(worktree, '.git');
  if (!existsSync(marker) || !statSync(marker).isFile()) return null;
  const pointer = /^gitdir: (.*)$/m.exec(readFileSync(marker, 'utf8'))?.[1]?.trim();
  return pointer === undefined ? null : dirname(dirname(pointer));
};

const repaired = (repository: string, worktrees: readonly string[]): readonly RelocationMiss[] => {
  const ran = Bun.spawnSync(['git', '--git-dir', repository, 'worktree', 'repair', ...worktrees], { stdout: 'pipe', stderr: 'pipe' });
  return ran.exitCode === 0 ? [] : [{ path: repository, detail: `git worktree repair: ${ran.stderr.toString().trim()}` }];
};

export const worktreeRelocation: Relocation = {
  id: 'worktrees/home',
  tables: ['worktree_operation'],
  relocate: (data) =>
    Effect.try({
      try: () => {
        const home = join(data.to, WORKTREE_HOME);
        const byRepository = new Map<string, string[]>();
        for (const project of entries(home)) {
          for (const name of entries(join(home, project))) {
            const worktree = join(home, project, name);
            const repository = repositoryOf(worktree);
            if (repository !== null) byRepository.set(repository, [...(byRepository.get(repository) ?? []), worktree]);
          }
        }
        return [...byRepository].flatMap(([repository, worktrees]) => repaired(repository, worktrees));
      },
      catch: (cause) => new RelocationFailed({ detail: String(cause) }),
    }),
};
