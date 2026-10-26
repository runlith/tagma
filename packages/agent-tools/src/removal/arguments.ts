import { ToolFailed } from '@runlith/agent/tool';
import { Effect } from 'effect';
import type { RemovalOptions } from './model';

export type RemovalArguments = {
  readonly options: RemovalOptions;
  readonly operands: readonly string[];
};

export const removalArguments = Effect.fnUntraced(function* (args: readonly string[]): Effect.fn.Return<RemovalArguments, ToolFailed> {
  const options = {
    recursive: false,
    force: false,
    directory: false,
    verbose: false,
    oneFileSystem: false,
    preserveRoot: 'root' as RemovalOptions['preserveRoot'],
  };
  const operands: string[] = [];
  let ended = false;
  for (const arg of args) {
    if (arg === '') return yield* new ToolFailed({ code: 'invalid-argument', reason: 'An rm operand cannot be empty.' });
    if (arg.includes('\0')) return yield* new ToolFailed({ code: 'invalid-argument', reason: 'An rm argument contains a null byte.' });
    if (ended || arg === '-' || !arg.startsWith('-')) {
      operands.push(arg);
      continue;
    }
    if (arg === '--') {
      ended = true;
      continue;
    }
    switch (arg) {
      case '--recursive':
        options.recursive = true;
        continue;
      case '--force':
        options.force = true;
        continue;
      case '--dir':
        options.directory = true;
        continue;
      case '--verbose':
        options.verbose = true;
        continue;
      case '--one-file-system':
        options.oneFileSystem = true;
        continue;
      case '--preserve-root':
        options.preserveRoot = 'root';
        continue;
      case '--preserve-root=all':
        options.preserveRoot = 'all';
        continue;
      case '--no-preserve-root':
        options.preserveRoot = 'none';
        continue;
    }
    const letters = arg.startsWith('--') ? [arg] : [...arg.slice(1)];
    for (const letter of letters) {
      switch (letter) {
        case 'r':
        case 'R':
          options.recursive = true;
          break;
        case 'f':
          options.force = true;
          break;
        case 'd':
          options.directory = true;
          break;
        case 'v':
          options.verbose = true;
          break;
        default: {
          const option = letter.startsWith('--') ? letter : `-${letter}`;
          const interactive = letter === 'i' || letter === 'I' || letter.startsWith('--interactive');
          return yield* new ToolFailed({
            code: 'unsupported-option',
            reason: interactive
              ? `${option} is interactive. Confirmations are determined by the Tagma call mode, not stdin.`
              : `Unsupported rm option: ${option}.`,
          });
        }
      }
    }
  }
  if (operands.length === 0 && !options.force)
    return yield* new ToolFailed({ code: 'missing-operand', reason: 'rm requires a path or pattern unless --force is set.' });
  return { options, operands };
});
