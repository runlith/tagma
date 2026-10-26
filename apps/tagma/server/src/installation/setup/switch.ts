import { accessSync, constants } from 'node:fs';
import { Clock, Data, Effect, Option } from 'effect';
import { pidAlive } from '@runlith/utils/process';
import { ASKED_EVERY_MS } from '../contract/wire/layout.js';
import { type ActiveHolder, holderName, junctionDirectory } from '../contract/wire/junction.js';

export class SwitchRefused extends Data.TaggedError('SwitchRefused')<{
  readonly code: 'channel-unnamed' | 'host-stayed';
  readonly reason: string;
  readonly unblock: string[];
}> {}

export type Switched = { readonly from: string; readonly host: string; readonly killed: boolean };

const SIGNALLED_GONE = 'ESRCH';

const LEAVE_DEADLINE_MS = 90_000;

const signalled = (pid: number, signal: NodeJS.Signals): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      process.kill(pid, signal);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== SIGNALLED_GONE) throw cause;
    }
  });

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const left = Effect.fnUntraced(function* (pid: number) {
  while (pidAlive(pid)) yield* Effect.sleep(ASKED_EVERY_MS);
});

const ENDED = new Set(['ShutdownComplete']);

const endedTag = (printed: string): string | null => {
  try {
    const answer = JSON.parse(printed) as { readonly _tag?: unknown; readonly installed?: unknown };
    return answer.installed === false ? 'None' : typeof answer._tag === 'string' ? answer._tag : null;
  } catch {
    return null;
  }
};

const hostEnded = Effect.fnUntraced(function* (cli: string, name: string): Effect.fn.Return<string, SwitchRefused> {
  const shutdown = [cli, 'execution-host', 'shutdown', `--operation=switch-${yield* Clock.currentTimeMillis}`, '--json'];
  const stayed = (said: string) =>
    new SwitchRefused({
      code: 'host-stayed',
      reason: `${name} left, and its execution host did not end: ${said}`,
      unblock: [`${shutdown.slice(0, -1).join(' ')} — run it again; the same operation resumes the shutdown, then switch again`],
    });
  if (!executable(cli)) return yield* stayed(`${cli} is not executable`);
  const ran = yield* Effect.promise(async () => {
    const child = Bun.spawn(shutdown, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout: stdout.trim(), said: `${stdout}\n${stderr}`.trim(), code };
  });
  const tag = ran.code === 0 ? endedTag(ran.stdout) : null;
  if (tag === 'None') return 'it ran no execution host';
  if (tag === null || !ENDED.has(tag)) return yield* stayed(`exit ${ran.code}: ${ran.said}`);
  return 'its execution host ended with every terminal and command it ran';
});

export const switchFrom = Effect.fnUntraced(function* (
  holder: ActiveHolder,
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<Switched, SwitchRefused> {
  const name = holderName(holder);
  const junction = junctionDirectory(env);
  if (holder === 'unnamed' || junction === null) {
    return yield* new SwitchRefused({
      code: 'channel-unnamed',
      reason: `${name} holds this Mac, and its record names no process to ask to leave`,
      unblock: [`quit ${name} from its window, then switch again`],
    });
  }
  yield* signalled(holder.pid, 'SIGTERM');
  const killed = Option.isNone(yield* Effect.timeoutOption(left(holder.pid), LEAVE_DEADLINE_MS));
  if (killed) {
    yield* signalled(holder.pid, 'SIGKILL');
    yield* left(holder.pid);
  }
  return { from: name, host: yield* hostEnded(holder.cli, name), killed };
});
