const RUNNERS = new Set(['bun', 'bunx', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'run', 'exec', 'x']);
const RUNNER_OPTIONS_WITH_VALUE = new Set(['--cwd', '--filter', '-F', '-C', '--prefix']);

export function commandWord(command: string): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  for (let at = 0; at < tokens.length; at += 1) {
    const token = tokens[at] as string;
    if (RUNNER_OPTIONS_WITH_VALUE.has(token)) {
      at += 1;
      continue;
    }
    if (token.startsWith('-') || RUNNERS.has(token)) continue;
    const slash = token.lastIndexOf('/');
    return slash === -1 ? token : token.slice(slash + 1);
  }
  return tokens[0] ?? command;
}
