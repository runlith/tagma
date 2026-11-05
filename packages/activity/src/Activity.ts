import { Cause, Clock, Context, Effect, Exit, Stream } from 'effect';
import { ActivityCause } from './cause';
import {
  activityKind,
  type ActivityActor,
  type ActivityBody,
  type ActivityKind,
  type ActivityNote,
  type ActivityOutcome,
  type ActivityParent,
  type ActivityTrigger,
  type RunTarget,
} from './fact';
import { type ActivityFaultNote, defectNote, degradedNote } from './fault';
import { ActivityLog } from './log';

export type ActivityFrame = {
  readonly id: string;
  readonly kind: string;
  readonly thread: string | null;
  readonly run: string | null;
  readonly project: number | null;
  readonly actor: ActivityActor;
  notes: number;
  bodies: number;
};

export const CurrentActivity = Context.Reference<ActivityFrame | null>('@runlith/activity/CurrentActivity', {
  defaultValue: () => null,
});

export type ActivityEnding<Result> = {
  readonly outcome?: ActivityOutcome;
  readonly reason?: string;
  readonly message?: string;
  readonly result?: Result;
  readonly bodies?: readonly ActivityBody[];
};

export type ActivityPlacement = {
  readonly thread?: string;
  readonly run?: string;
  readonly project?: number;
  readonly parent?: ActivityParent;
  readonly outside?: RunTarget;
  readonly actor?: ActivityActor;
  readonly trigger?: ActivityTrigger | null;
  readonly bodies?: readonly ActivityBody[];
};

export type ActivityOptions<Result, Exited> = ActivityPlacement & {
  readonly ended?: (exit: Exited) => ActivityEnding<Result>;
};

type Opened = { readonly log: ActivityLog; readonly frame: ActivityFrame };

export function activity<A, E, R, Attrs extends object, Result extends object>(
  kind: ActivityKind<Attrs, Result>,
  attrs: Attrs,
  work: Effect.Effect<A, E, R>,
  options: ActivityOptions<Result, Exit.Exit<A, E>> = {},
): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.flatMap(open(kind.name, attrs, options), (opened) =>
      Effect.onExit(restore(Effect.provideService(work, CurrentActivity, opened.frame)), (exit) => close(opened, exit, options.ended)),
    ),
  );
}

export function activityStream<A, E, R, Attrs extends object, Result extends object>(
  kind: ActivityKind<Attrs, Result>,
  attrs: Attrs,
  work: Stream.Stream<A, E, R>,
  options: ActivityOptions<Result, Exit.Exit<unknown, unknown>> = {},
): Stream.Stream<A, E, R> {
  return Stream.unwrap(
    Effect.map(
      Effect.acquireRelease(open(kind.name, attrs, options), (opened, exit) => close(opened, exit, options.ended)),
      (opened) => Stream.provideService(work, CurrentActivity, opened.frame),
    ),
  );
}

export function note<N extends ActivityNote>(fact: N, outside?: RunTarget): Effect.Effect<number | null> {
  return Effect.map(Effect.all([ActivityLog, CurrentActivity, Clock.currentTimeMillis]), ([log, current, at]) => {
    if (current === null || (outside !== undefined && outside.run !== current.run)) {
      if (outside !== undefined) log.record({ _tag: 'Noted', activity: outside, at, note: fact });
      return null;
    }
    current.notes += 1;
    log.record({ _tag: 'Noted', activity: current.id, at, note: fact });
    return current.notes;
  });
}

const FAULT = activityKind<{ readonly place: string }>('fault');

export function defected(cause: Cause.Cause<unknown>, place?: string, placement?: ActivityPlacement): Effect.Effect<void> {
  return Effect.flatMap(CurrentActivity, (current) => {
    const told = defectNote(place ?? current?.kind ?? FAULT.name, cause);
    return told === null ? Effect.void : faulted(told, placement);
  });
}

export function degraded<A, E, R>(place: string, why: string, work: Effect.Effect<A, E, R>, fallback: () => A): Effect.Effect<A, E, R> {
  return Effect.catchCause(work, (cause) =>
    Cause.hasInterrupts(cause) || !Cause.hasDies(cause)
      ? Effect.failCause(cause)
      : Effect.as(faulted(degradedNote(place, why, cause)), fallback()),
  );
}

function faulted(told: ActivityFaultNote, placement?: ActivityPlacement): Effect.Effect<void> {
  return Effect.flatMap(CurrentActivity, (current) =>
    current === null ? activity(FAULT, { place: told.place }, Effect.asVoid(note(told)), placement) : Effect.asVoid(note(told)),
  );
}

export type ActivityWitness = {
  readonly log: ActivityLog;
  readonly clock: Clock.Clock;
  readonly thread: string | null;
  readonly run: string | null;
};

export function degradedSync<A>(witness: ActivityWitness, place: string, why: string, compute: () => A, fallback: () => A): A {
  try {
    return compute();
  } catch (defect) {
    toldDegraded(witness, place, why, defect);
    return fallback();
  }
}

export function toldDegraded(witness: ActivityWitness, place: string, why: string, defect: unknown): void {
  const at = witness.clock.currentTimeMillisUnsafe();
  const id = mint(at);
  const { log, thread, run } = witness;
  log.record({
    _tag: 'Opened',
    id,
    at,
    parent: run === null ? null : { run },
    thread,
    run,
    project: null,
    kind: FAULT.name,
    actor: { kind: 'server', name: FAULT.name },
    trigger: null,
    attrs: { place },
  });
  log.record({ _tag: 'Noted', activity: id, at, note: degradedNote(place, why, Cause.die(defect)) });
  log.record({ _tag: 'Ended', activity: id, at, outcome: 'ok', reason: null, message: null, result: {} });
}

export function body(recorded: ActivityBody): Effect.Effect<number | null> {
  return Effect.map(Effect.all([ActivityLog, CurrentActivity, Clock.currentTimeMillis]), ([log, current, at]) =>
    current === null ? null : bodied(log, current, at, recorded),
  );
}

function open(kind: string, attrs: object, options: ActivityPlacement): Effect.Effect<Opened> {
  return Effect.map(Effect.all([ActivityLog, CurrentActivity, ActivityCause, Clock.currentTimeMillis]), ([log, current, cause, at]) => {
    const frame: ActivityFrame = {
      id: mint(at),
      kind,
      thread: options.thread ?? current?.thread ?? null,
      run: options.run ?? current?.run ?? null,
      project: options.project ?? current?.project ?? null,
      actor: options.actor ?? current?.actor ?? cause?.actor ?? { kind: 'server', name: kind },
      notes: 0,
      bodies: 0,
    };
    log.record({
      _tag: 'Opened',
      id: frame.id,
      at,
      parent: options.parent ?? current?.id ?? options.outside ?? null,
      thread: frame.thread,
      run: frame.run,
      project: frame.project,
      kind,
      actor: frame.actor,
      trigger: options.trigger === undefined ? ((current === null ? cause?.trigger : undefined) ?? null) : options.trigger,
      attrs,
    });
    for (const body of options.bodies ?? []) bodied(log, frame, at, body);
    return { log, frame };
  });
}

function close<Result, Exited extends Exit.Exit<unknown, unknown>>(
  { log, frame }: Opened,
  exit: Exited,
  ended: ((exit: Exited) => ActivityEnding<Result>) | undefined,
): Effect.Effect<void> {
  return Effect.map(Clock.currentTimeMillis, (at) => {
    const standing = endingOf(exit);
    const told = Exit.isFailure(exit) && standing.reason === 'Defect' ? defectNote(frame.kind, exit.cause) : null;
    if (told !== null) {
      frame.notes += 1;
      log.record({ _tag: 'Noted', activity: frame.id, at, note: told });
    }
    let chosen: ActivityEnding<Result> = {};
    try {
      chosen = ended === undefined ? {} : ended(exit);
    } catch (cause) {
      const failed = { type: 'ending-failed', message: messageOf(cause) };
      frame.notes += 1;
      log.record({ _tag: 'Noted', activity: frame.id, at, note: failed });
    }
    for (const body of chosen.bodies ?? []) bodied(log, frame, at, body);
    log.record({
      _tag: 'Ended',
      activity: frame.id,
      at,
      outcome: chosen.outcome ?? standing.outcome,
      reason: chosen.reason ?? standing.reason,
      message: chosen.message ?? standing.message,
      result: chosen.result ?? {},
    });
  });
}

function endingOf(exit: Exit.Exit<unknown, unknown>): {
  readonly outcome: ActivityOutcome;
  readonly reason: string | null;
  readonly message: string | null;
} {
  if (Exit.isSuccess(exit)) return { outcome: 'ok', reason: null, message: null };
  const failed = Cause.findError(exit.cause);
  if (failed._tag === 'Success') {
    const error = failed.success;
    return { outcome: 'failed', reason: tagOf(error), message: messageOf(error) };
  }
  if (Cause.hasInterruptsOnly(exit.cause)) return { outcome: 'cancelled', reason: 'Interrupted', message: null };
  return { outcome: 'failed', reason: 'Defect', message: messageOf(Cause.squash(exit.cause)) };
}

function tagOf(error: unknown): string {
  return typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string' ? error._tag : 'Error';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bodied(log: ActivityLog, frame: ActivityFrame, at: number, body: ActivityBody): number {
  frame.bodies += 1;
  log.record({ _tag: 'Bodied', activity: frame.id, n: frame.bodies, at, thread: frame.thread, body });
  return frame.bodies;
}

function mint(at: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = at;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
