import type { CommandClass } from '@runlith/executions/protocol/command';

const TOOLS: ReadonlyMap<string, CommandClass> = new Map([
  ['git', 'git'],
  ['tsc', 'typecheck'],
  ['svelte-check', 'typecheck'],
  ['vitest', 'test'],
]);

const SCRIPTS: ReadonlyMap<string, CommandClass> = new Map([
  ['test', 'test'],
  ['typecheck', 'typecheck'],
]);

const RUNTIMES: ReadonlySet<string> = new Set(['bun', 'bunx', 'npm', 'npx', 'pnpm', 'yarn', 'node']);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function commandClass(line: string): CommandClass {
  const words = line
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  let index = 0;
  while (index < words.length && ASSIGNMENT.test(words[index] as string)) index += 1;
  const program = basename(words[index]);
  if (program === undefined) return 'other';
  const direct = TOOLS.get(program);
  if (direct !== undefined) return direct;
  if (!RUNTIMES.has(program)) return 'other';
  for (let after = index + 1; after < words.length; after += 1) {
    const word = words[after] as string;
    if (word.startsWith('-')) continue;
    const named = SCRIPTS.get(word) ?? (word.includes('/') || word.includes('\\') ? undefined : TOOLS.get(word));
    if (named !== undefined) return named;
  }
  return 'other';
}

function basename(word: string | undefined): string | undefined {
  if (word === undefined) return undefined;
  const cut = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'));
  const name = cut === -1 ? word : word.slice(cut + 1);
  return name === '' ? undefined : name;
}
