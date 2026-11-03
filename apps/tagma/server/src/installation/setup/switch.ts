import { accessSync, constants } from 'node:fs';
import { Clock, Data, Effect } from 'effect';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { LockHolders } from '../contract/service/lockHolders.js';
import { chainAt, stopChain, stopProcess } from '../process/chain.js';
import { ACTIVE_LOCK } from '../contract/wire/junction.js';
import { type ActiveHolder, holderName, junctionDirectory } from '../contract/wire/junction.js';

export class SwitchRefused extends Data.TaggedError('SwitchRefused')<{
  readonly code: 'channel-unnamed' | 'host-stayed' | 'chain-unproven';
  readonly reason: string;
  readonly unblock: string[];
}> {}

export type Switched = { readonly from: string; readonly host: string; readonly killed: boolean };

const chainUnproven = (name: string) => (detail: string) =>
  new SwitchRefused({
    code: 'chain-unproven',
    reason: `${name} may have started again; its process chain could not be proven stopped: ${detail}`,
    unblock: ['press Stop again to stop any Tagma that came back'],
  });

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

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

export const stopUnheld = Effect.fn('installation.stopUnheld')(function* (data: string, name: string) {
  const unproven = chainUnproven(name);
  const chain = yield* chainAt(data).pipe(Effect.mapError((failure) => unproven(failure.detail)));
  if (chain === null) return null;
  const stopped = yield* stopChain(chain.reference).pipe(Effect.mapError((failure) => unproven(failure.detail)));
  if (!stopped.running) return null;
  if (chain.cli === null) return yield* unproven('the process generation records no command for ending its execution host');
  return { from: name, host: yield* hostEnded(chain.cli, name), killed: stopped.killed } satisfies Switched;
});

export const switchFrom = Effect.fnUntraced(function* (
  holder: ActiveHolder,
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<Switched, SwitchRefused, Processes | LockHolders> {
  const name = holderName(holder);
  const junction = junctionDirectory(env);
  if (holder === 'unnamed' || junction === null) {
    return yield* new SwitchRefused({
      code: 'channel-unnamed',
      reason: `${name} holds this Mac, and its record names no process to ask to leave`,
      unblock: [`quit ${name} from its window, then switch again`],
    });
  }
  const unproven = chainUnproven(name);
  if (holder.chain !== undefined) {
    const stopped = yield* stopChain(holder.chain).pipe(Effect.mapError((failure) => unproven(failure.detail)));
    return { from: name, host: yield* hostEnded(holder.cli, name), killed: stopped.killed };
  }
  const reader = yield* Processes;
  const current = reader.identity(holder.pid);
  if (current._tag !== 'Read' || current.zombie || (holder.birth !== undefined && holder.birth !== current.birth)) {
    return yield* unproven(
      current._tag === 'Unreadable' ? current.detail : 'the recorded process has left or its PID belongs to another process',
    );
  }
  if (holder.birth === undefined) {
    const held = yield* Effect.flatMap(LockHolders, (holders) => holders.of(`${junction}/${ACTIVE_LOCK}`));
    if (held._tag === 'Unread' || !held.pids.includes(holder.pid))
      return yield* unproven(held._tag === 'Unread' ? held.detail : 'the recorded PID does not hold the active lock file');
  }
  yield* stopProcess({ pid: holder.pid, birth: current.birth }).pipe(Effect.mapError((failure) => unproven(failure.detail)));
  yield* hostEnded(holder.cli, name);
  return yield* unproven('this issued server does not record or cancel its automatic returns');
});
