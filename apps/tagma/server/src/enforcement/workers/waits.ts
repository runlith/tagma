import { Clock, Cause, Effect, Exit, Layer, Option, Tracer } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { InspectionAnswer, LostExit, PhaseClosed, PhaseOpened, Spawned, StateAnswer } from './asks.js';

type Held = {
  readonly pid: number;
  readonly command: string;
  readonly since: number;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  released: boolean;
  absent: number;
};

const PROBE_MS = 250;

const PROBES_ABSENT = 6;

type Phase = { readonly id: number; readonly about: number; readonly name: string; readonly since: number };

const PHASE = 'inspecting.';

let received = 0;
let given: InspectionAnswer | undefined;
let moves = 0;
let port: Worker | undefined;
let nextPhase = 0;
const held = new Set<Held>();
const phases = new Map<number, Phase>();

export const reporting = (to: Worker): void => {
  port = to;
};

export const taken = (id: number): void => {
  received = id;
  moves += 1;
};

export const gave = (reply: InspectionAnswer): InspectionAnswer => {
  given = reply;
  moves += 1;
  return reply;
};

const endedOf = (exit: Exit.Exit<unknown, unknown>): PhaseClosed['ended'] =>
  Exit.isSuccess(exit) ? 'ok' : Cause.hasInterruptsOnly(exit.cause) ? 'interrupted' : 'failed';

const plain = (attributes: ReadonlyMap<string, unknown>): PhaseClosed['attributes'] => {
  const kept: Record<string, string | number | boolean> = {};
  for (const [key, value] of attributes)
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') kept[key] = value;
  return kept;
};

class Traced extends Tracer.NativeSpan {
  constructor(
    options: ConstructorParameters<typeof Tracer.NativeSpan>[0],
    readonly phase: Phase | undefined,
    readonly within: number | null,
  ) {
    super(options);
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === 'Ended') return;
    super.end(endTime, exit);
    moves += 1;
    const phase = this.phase;
    if (phase === undefined) return;
    phases.delete(phase.id);
    port?.postMessage({
      phase: 'close',
      about: phase.about,
      id: phase.id,
      ended: endedOf(exit),
      attributes: plain(this.attributes),
    } satisfies PhaseClosed);
  }
}

export const phaseTracer = Tracer.make({
  span(options) {
    moves += 1;
    const parent = Option.getOrUndefined(options.parent);
    const within = parent instanceof Traced ? parent.within : null;
    if (!options.name.startsWith(PHASE)) return new Traced(options, undefined, within);
    const phase: Phase = { id: ++nextPhase, about: received, name: options.name, since: Date.now() };
    phases.set(phase.id, phase);
    port?.postMessage({ phase: 'open', about: phase.about, id: phase.id, parent: within, name: phase.name } satisfies PhaseOpened);
    return new Traced(options, phase, phase.id);
  },
});

const runningOf = (one: Held): Spawned['running'] => {
  const read = Effect.runSyncExit(one.handle.isRunning);
  return Exit.isSuccess(read) ? read.value : { unread: Cause.pretty(read.cause) };
};

const prune = (): void => {
  for (const one of held) if (one.released && runningOf(one) === false) held.delete(one);
};

const commandOf = (command: ChildProcess.Command): string =>
  ChildProcess.isStandardCommand(command) ? [command.command, ...command.args].join(' ') : 'a piped command';

const reaped = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
};

let probing: ReturnType<typeof setInterval> | undefined;

const probe = (): void => {
  const lost: Held[] = [];
  let unseen = false;
  for (const one of held) {
    if (runningOf(one) !== true) continue;
    unseen = true;
    one.absent = reaped(one.pid) ? one.absent + 1 : 0;
    if (one.absent >= PROBES_ABSENT) lost.push(one);
  }
  if (lost.length > 0) {
    const now = Date.now();
    port?.postMessage({
      lost: 'exit',
      spawned: lost.map((one) => ({
        pid: one.pid,
        command: one.command,
        ms: now - one.since,
        running: true,
        released: one.released,
        system: 'gone',
      })),
    } satisfies LostExit);
  }
  if (!unseen) {
    clearInterval(probing);
    probing = undefined;
  }
};

export const watching = <E, R>(
  spawning: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, E, R>,
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner, E, R> =>
  Layer.effect(
    ChildProcessSpawner.ChildProcessSpawner,
    Effect.gen(function* () {
      const inner = yield* ChildProcessSpawner.ChildProcessSpawner;
      return ChildProcessSpawner.make((command) =>
        Effect.gen(function* () {
          const handle = yield* inner.spawn(command);
          prune();
          const one: Held = {
            pid: Number(handle.pid),
            command: commandOf(command),
            since: yield* Clock.currentTimeMillis,
            handle,
            released: false,
            absent: 0,
          };
          held.add(one);
          moves += 1;
          if (probing === undefined) {
            probing = setInterval(probe, PROBE_MS);
            probing.unref();
          }
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              one.released = true;
              moves += 1;
              if (runningOf(one) === false) held.delete(one);
            }),
          );
          return handle;
        }),
      );
    }),
  ).pipe(Layer.provide(spawning));

type System = { readonly states: ReadonlyMap<number, 'running' | 'zombie' | 'gone'> } | { readonly unread: string };

const PS_LINE = /^\s*(\d+)\s+(\S+)/;

const systemOf = (pids: readonly number[]): System => {
  if (pids.length === 0) return { states: new Map() };
  let ran: { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string };
  try {
    const child = Bun.spawnSync(['ps', '-o', 'pid=,stat=', '-p', pids.join(',')], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    ran = { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  } catch (error) {
    return { unread: `ps did not start: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (ran.exitCode !== 0 && ran.exitCode !== 1) return { unread: `ps exited ${ran.exitCode}: ${ran.stderr.trim()}` };
  const seen = new Map<number, string>();
  for (const line of ran.stdout.split('\n')) {
    const found = PS_LINE.exec(line);
    if (found !== null) seen.set(Number(found[1]), found[2]!);
  }
  return {
    states: new Map(
      pids.map((pid) => {
        const stat = seen.get(pid);
        return [pid, stat === undefined ? 'gone' : stat.startsWith('Z') ? 'zombie' : 'running'] as const;
      }),
    ),
  };
};

const turned = (): Promise<void> => new Promise((settled) => setTimeout(settled, 0));

export const stateOf = async (about: number, look: number): Promise<StateAnswer> => {
  await turned();
  prune();
  const now = Date.now();
  const read = [...held].map((one) => ({ one, running: runningOf(one) }));
  const system = systemOf(read.filter(({ running }) => running === true).map(({ one }) => one.pid));
  const spawned: Spawned[] = read.map(({ one, running }) => ({
    pid: one.pid,
    command: one.command,
    ms: now - one.since,
    running,
    released: one.released,
    system: running === true && 'states' in system ? (system.states.get(one.pid) ?? null) : null,
  }));
  return {
    about,
    look,
    state: {
      received,
      moves,
      spawned,
      phases: [...phases.values()].map((phase) => ({ name: phase.name, ms: now - phase.since })),
      unread: 'unread' in system ? system.unread : undefined,
      answer: given?.id === about ? given : undefined,
    },
  };
};
