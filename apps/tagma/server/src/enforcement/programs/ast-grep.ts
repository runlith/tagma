import { join, posix } from 'node:path';
import { AST_GREP_MIN_VERSION, planAstGrep, readAstGrep, ruleDirectories, type RuleFile } from '@tagma/inspection/node/runners/ast-grep';
import { Effect, Result } from 'effect';
import { checkerConfig, filesAnswer, filesFailed, type FileAdapter, type FilesRunner } from './filesRunner.js';
import { reachFiles, writeInto } from './layout.js';
import { requireVersion } from './version.js';

const adapter: FileAdapter = {
  id: 'ast-grep',
  argv: Effect.fnUntraced(function* (checker) {
    yield* requireVersion(join(checker.cwd, 'node_modules/@ast-grep/cli/package.json'), 'ast-grep', AST_GREP_MIN_VERSION);
    const suffix = process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : '';
    const pkg = `@ast-grep/cli-${process.platform}-${process.arch}${suffix}`;
    const native = join(checker.cwd, 'node_modules', pkg);
    yield* requireVersion(join(native, 'package.json'), 'ast-grep', AST_GREP_MIN_VERSION);
    return [join(native, process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep')] as const;
  }),
  plan: Effect.fnUntraced(function* (input, sides, checker) {
    const config = yield* checkerConfig(input, checker);
    const dirs = ruleDirectories(config.text);
    if (Result.isFailure(dirs)) return yield* filesFailed('ast-grep', dirs.failure);
    const failed = (reason: string) => filesFailed('ast-grep', `its rule directories could not be read: ${reason}`);
    const places = dirs.success.map((dir) => posix.join(posix.dirname(config.path), dir));
    const rules: readonly RuleFile[] = yield* reachFiles(input.root, input.tree, places, (path) => /\.ya?ml$/.test(path), failed);
    yield* writeInto(config.dir, rules, 'rule directories', failed);
    const plan = planAstGrep(input, sides, config, rules);
    return Result.isFailure(plan) ? yield* filesFailed('ast-grep', plan.failure) : plan.success;
  }),
  read: readAstGrep,
};
export const astGrepRunner: FilesRunner = { id: 'ast-grep', answer: (road, launch) => filesAnswer(road, launch, adapter) };
