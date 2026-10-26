import { Data, Effect } from 'effect';

export const CLI_NAME = 'tailscale';

export const CLI_DEADLINE_MS = 20_000;

const INSTALLED_FILES: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale'],
  win32: ['C:\\Program Files\\Tailscale\\tailscale.exe'],
};

export class CliLaunchFailed extends Data.TaggedError('CliLaunchFailed')<{
  readonly binary: string;
  readonly reason: string;
}> {}

export type CliRun = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

export const locateCli: Effect.Effect<string | null> = Effect.promise(async () => {
  const onPath = Bun.which(CLI_NAME, { PATH: process.env.PATH });
  if (onPath !== null) return onPath;
  for (const file of INSTALLED_FILES[process.platform] ?? []) {
    if (await Bun.file(file).exists()) return file;
  }
  return null;
});

export const runCli = (
  binary: string,
  args: readonly string[],
  deadlineMs: number = CLI_DEADLINE_MS,
): Effect.Effect<CliRun, CliLaunchFailed> =>
  Effect.tryPromise({
    try: async (signal) => {
      const child = Bun.spawn([binary, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', signal });
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, deadlineMs);
      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode: timedOut ? null : exitCode, stdout, stderr, timedOut };
      } finally {
        clearTimeout(deadline);
      }
    },
    catch: (cause) => new CliLaunchFailed({ binary, reason: cause instanceof Error ? cause.message : String(cause) }),
  });

export const succeeded = (run: CliRun): boolean => run.exitCode === 0 && !run.timedOut;

export const outputOf = (run: CliRun): string =>
  [run.stdout, run.stderr]
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n');

export const failureOf = (run: CliRun, deadlineMs: number = CLI_DEADLINE_MS): string => {
  const output = outputOf(run);
  if (output.length > 0) return output;
  return run.timedOut ? `${CLI_NAME} did not finish within ${deadlineMs / 1000} seconds` : `${CLI_NAME} exited with code ${run.exitCode}`;
};
