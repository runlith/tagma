const VERSION_MS = 5_000;

export const versionOf = (claude: string): string | null => {
  const ran = Bun.spawnSync([claude, '--version'], { stdout: 'pipe', stderr: 'ignore', timeout: VERSION_MS });
  if (ran.exitCode !== 0) return null;
  return /^(\d+\.\d+\.\d+)/.exec(ran.stdout.toString().trim())?.[1] ?? null;
};
