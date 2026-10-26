import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunnerDescriptor } from '@tagma/inspection/program';
import { isLinter, type Programmed } from '../contract/wire/document.js';

export const RUNNER = fileURLToPath(new URL('./runner.ts', import.meta.url));
export const PRELOAD = fileURLToPath(new URL('./treePreload.ts', import.meta.url));

export type Checker = {
  readonly id: string;
  readonly descriptor: RunnerDescriptor;
  readonly launch: readonly [string, ...string[]] | null;
  readonly cwd: string;
};

const launchOf = (root: string, argv: RunnerDescriptor['argv']): readonly [string, ...string[]] | null => {
  if (argv === undefined) return null;
  const [first, ...rest] = argv;
  const program = first === 'bun' ? process.execPath : first.includes('/') && !isAbsolute(first) ? join(root, first) : first;
  return [program, ...rest];
};

export const checkerFor = (root: string, check: Programmed): Checker => {
  const { program } = check;
  if (isLinter(program)) {
    const { linter } = program;
    const adapter = linter.tool === 'command' ? `command-${linter.output}` : linter.tool;
    const config = 'config' in linter ? linter.config : undefined;
    const descriptor: RunnerDescriptor = { id: adapter, adapter, argv: linter.argv, config, layout: 'files' };
    return { id: JSON.stringify(linter), descriptor, launch: launchOf(root, linter.argv), cwd: root };
  }
  const argv: [string, ...string[]] = ['bun', '--no-install', '--preload', PRELOAD, RUNNER, program.program];
  const descriptor: RunnerDescriptor = {
    id: program.program,
    adapter: 'program',
    argv,
    layout: 'program',
    needs: program.needs.length === 0 ? undefined : { facts: [program.needs[0]!, ...program.needs.slice(1)] },
  };
  return { id: program.program, descriptor, launch: launchOf(root, argv), cwd: root };
};
