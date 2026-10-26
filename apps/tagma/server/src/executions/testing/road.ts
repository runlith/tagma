import { Effect } from 'effect';
import type { ProgramEnding, ProgramLaunch, ProgramRoad } from '../contract/service/programs.js';

export const localRoad = (launches: ProgramLaunch[], options: { readonly timeMs?: number } = {}): ProgramRoad['Service'] => ({
  run: (launch) =>
    Effect.promise(async (): Promise<ProgramEnding> => {
      launches.push(launch);
      let child: Bun.Subprocess<Blob, 'pipe', 'pipe'>;
      try {
        child = Bun.spawn([...launch.argv, ...(launch.operands ?? [])], {
          cwd: launch.cwd,
          env: { ...process.env, ...launch.env },
          stdin: new Blob([launch.stdin]),
          stdout: 'pipe',
          stderr: 'pipe',
        });
      } catch {
        return { _tag: 'Unrun', said: `${launch.argv[0]} was not found or is not executable`, missing: process.env.PATH ?? '' };
      }
      let late = false;
      const timer =
        options.timeMs === undefined
          ? undefined
          : setTimeout(() => {
              late = true;
              child.kill();
            }, options.timeMs);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      clearTimeout(timer);
      return late
        ? { _tag: 'Stopped', late: true, said: `${launch.subject} was cancelled (timeout)`, stderr }
        : { _tag: 'Exited', exitCode, stdout, stderr, cut: false };
    }),
});
