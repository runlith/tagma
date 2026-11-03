import { Deferred, Effect, FileSystem, type PlatformError } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { broken, command, LSOF, PS, type ProbeLimits } from './evidence';
import { StandingUnreadable } from '../../PlatformFacts';
import type { LoadedLibrary } from '../Library';

export const MACHINE_PROBE_LIMITS: ProbeLimits = { outputBytes: 262_144, errorBytes: 8_192 };

const PTMX = '/dev/ptmx';
const DEVICES = '/dev';
const TTYS = /^ttys[0-9]+$/;

export const readStanding = Effect.fn('posix.readStanding')(function* (
  limits: ProbeLimits,
  holder: number,
  loaded: LoadedLibrary,
  observe: () => void = () => {},
) {
  const uid = process.getuid?.() ?? -1;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const descriptors = yield* openDescriptors(loaded, holder, observe);
  const diagnostic = new Set<number>();
  const running = new Set<Deferred.Deferred<void>>();
  const probes = ChildProcessSpawner.make((asked) =>
    Effect.gen(function* () {
      const siblings = [...running];
      const ended = yield* Deferred.make<void>();
      running.add(ended);
      yield* Effect.addFinalizer(() =>
        Effect.andThen(
          Effect.sync(() => running.delete(ended)),
          Deferred.succeed(ended, undefined),
        ),
      );
      const child = yield* spawner.spawn(asked).pipe(
        Effect.catchReason('PlatformError', 'Unknown', (_reason, error) =>
          processLimit(error) && siblings.length > 0
            ? Effect.andThen(
                Effect.forEach(siblings, (sibling) => Deferred.await(sibling), { discard: true }),
                spawner.spawn(asked),
              )
            : Effect.fail(error),
        ),
      );
      diagnostic.add(child.pid);
      return child;
    }),
  );
  const census = yield* Effect.all(
    {
      processes: rows(
        `the processes of user ${uid}`,
        PS,
        ['-o', 'pid=', '-U', String(uid)],
        limits,
        (line) => Number.isInteger(Number(line.trim())) && Number(line.trim()) > 0,
      ),
      terminals: masters(limits, holder).pipe(Effect.catchTag('StandingUnreadable', () => allocated)),
    },
    { concurrency: 2 },
  ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, probes));
  const processes = census.processes.filter((line) => !diagnostic.has(Number(line.trim()))).length;
  if (processes === 0)
    return yield* new StandingUnreadable({
      region: `the processes of user ${uid}`,
      detail: 'the census listed no non-diagnostic process, but its caller belongs to this user',
    });
  return { terminals: census.terminals, processes, ...descriptors };
});

const processLimit = (error: PlatformError.PlatformError): boolean => {
  const cause = 'cause' in error.reason ? error.reason.cause : undefined;
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EAGAIN';
};

const openDescriptors = Effect.fnUntraced(function* (loaded: LoadedLibrary, holder: number, observe: () => void) {
  const { logic, held } = yield* Effect.sync(() => {
    const logic = loaded.abi.descriptors(process.pid);
    const held = loaded.abi.descriptors(holder);
    observe();
    return { logic, held };
  });
  if ('refusal' in logic) return yield* new StandingUnreadable({ region: 'the logic descriptors', detail: logic.detail });
  if ('refusal' in held) return yield* new StandingUnreadable({ region: 'the holder descriptors', detail: held.detail });
  return { descriptors: logic.count, holderDescriptors: held.count };
});

const allocated: Effect.Effect<number, StandingUnreadable, FileSystem.FileSystem> = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const devices = yield* files
    .readDirectory(DEVICES)
    .pipe(Effect.mapError((error) => new StandingUnreadable({ region: `the terminals allocated in ${DEVICES}`, detail: error.message })));
  return devices.filter((name) => TTYS.test(name)).length;
});

const masters = Effect.fnUntraced(function* (limits: ProbeLimits, holder: number) {
  const region = `the terminal masters open on ${PTMX}`;
  const output = yield* command(LSOF, ['-nP', '-w', '-Fpf', PTMX], limits).pipe(
    Effect.mapError((failure) => new StandingUnreadable({ region, detail: failure.detail })),
  );
  if (output.truncated || broken(output) || (output.exitCode !== undefined && output.exitCode > 1))
    return yield* new StandingUnreadable({
      region,
      detail:
        output.failed ??
        (output.truncated
          ? `${LSOF} was read to ${limits.outputBytes} bytes and stopped`
          : `${LSOF} exited ${output.exitCode ?? 'by signal'}`),
    });
  let pid = 0;
  let masters = 0;
  for (const line of output.text.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (/^f[0-9]+$/.test(line) && pid !== holder) masters++;
  }
  return masters;
});

const rows = Effect.fnUntraced(function* (
  region: string,
  program: string,
  args: ReadonlyArray<string>,
  limits: ProbeLimits,
  counts: (line: string) => boolean,
) {
  const output = yield* command(program, args, limits).pipe(
    Effect.mapError((failure) => new StandingUnreadable({ region, detail: failure.detail })),
  );
  if (broken(output) || output.truncated || output.exitCode !== 0)
    return yield* new StandingUnreadable({
      region,
      detail:
        output.failed ??
        (output.truncated
          ? `${program} was read to ${limits.outputBytes} bytes and stopped`
          : `${program} exited ${output.exitCode ?? 'by signal'}`),
    });
  const found = output.text.split('\n').filter(counts);
  return found.length === 0
    ? yield* new StandingUnreadable({ region, detail: `${program} listed none, and this process stands in that population` })
    : found;
});
