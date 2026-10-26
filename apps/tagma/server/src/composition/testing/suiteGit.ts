import { Effect } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';

const IDENTITY = ['-c', 'user.name=suite', '-c', 'user.email=suite@tagma'] as const;

export const suiteGitRan = (cwd: string, ...args: readonly string[]) => spawnedEffect(['git', ...IDENTITY, ...args], { cwd });

export const suiteGitText = Effect.fn('suiteGit')(function* (cwd: string, ...args: readonly string[]) {
  const ran = yield* suiteGitRan(cwd, ...args);
  if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} in ${cwd}: ${ran.stderr.toString()}`));
  return ran.stdout.toString();
});

export const suiteGit = (cwd: string, ...args: readonly string[]) => Effect.map(suiteGitText(cwd, ...args), (text) => text.trim());
