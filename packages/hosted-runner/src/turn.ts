import { Deferred, Effect, Exit, Fiber, Option, Predicate } from 'effect';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { PromptResult } from '@runlith/acp/methods';
import { OPENED } from './wire/extensions.js';
import type { Session, Steered, Withdrawn } from './cycle.js';
import type { HostedDoor } from './door.js';

const CANCELLED = -32800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Word = {
  readonly prompt: readonly ContentBlock[];
  readonly input: string | undefined;
  readonly done: Deferred.Deferred<Steered, AgentFault>;
};

type Running = {
  readonly halted: Deferred.Deferred<void, AgentFault>;
  readonly early: Word[];
  sent: boolean;
  cancelled: boolean;
};

const cancelled = () => new AgentFault({ code: CANCELLED, message: 'the turn was cancelled before the agent read these words' });

const heard = (fault: AgentFault): AgentFault => {
  const data = Predicate.isObject(fault.data) ? fault.data : fault.data === undefined ? {} : null;
  if (data === null) return fault;
  const meta = Predicate.isObject(data._meta) ? data._meta : {};
  return new AgentFault({ code: fault.code, message: fault.message, data: { ...data, _meta: { ...meta, [OPENED]: true } } });
};

export class Turn {
  private running: Running | null = null;

  constructor(
    private readonly door: HostedDoor,
    private readonly session: Session,
  ) {}

  busy(): boolean {
    return this.running !== null || this.session.busy();
  }

  readonly prompt = Effect.fnUntraced(function* (this: Turn, prompt: readonly ContentBlock[], turn: unknown) {
    if (this.busy())
      return yield* new AgentFault({
        code: FAULT.invalidRequest,
        message: 'a turn is already running in this session; send words into it with _tagma/steer',
      });
    const id = typeof turn === 'string' && UUID.test(turn) ? turn : crypto.randomUUID();
    const running: Running = { halted: yield* Deferred.make<void, AgentFault>(), early: [], sent: false, cancelled: false };
    this.running = running;
    this.session.turning?.(true);
    const { door, session } = this;
    const opened = yield* Effect.exit(
      Effect.raceFirst(
        Effect.gen(function* () {
          const [opened, listed] = yield* Effect.zip(door.turn(), door.tools());
          yield* session.prepare({ opened, listed });
          return Option.some(opened.context);
        }),
        Effect.as(Deferred.await(running.halted), Option.none<string | null>()),
      ),
    );
    if (Exit.isFailure(opened)) {
      this.running = null;
      this.session.turning?.(false);
      for (const word of running.early) yield* Deferred.failCause(word.done, opened.cause);
      return yield* Effect.failCause(opened.cause);
    }
    if (running.cancelled || Option.isNone(opened.value)) {
      this.running = null;
      this.session.turning?.(false);
      for (const word of running.early) yield* Deferred.fail(word.done, cancelled());
      return { stopReason: 'cancelled', _meta: { 'tagma/turn': { prompt: id, last: null } } } satisfies PromptResult;
    }
    running.sent = true;
    const taken = yield* Deferred.make<void>();
    const started = yield* Effect.exit(
      this.session.start({ id, prompt, context: opened.value.value, taken: Effect.asVoid(Deferred.succeed(taken, undefined)) }),
    );
    if (Exit.isFailure(started)) {
      this.running = null;
      this.session.turning?.(false);
      for (const word of running.early) yield* Deferred.failCause(word.done, started.cause);
      return yield* Effect.failCause(started.cause);
    }
    const words = [];
    for (const word of running.early.splice(0)) {
      words.push(yield* Effect.forkChild(Deferred.complete(word.done, this.session.steer(word.prompt, word.input))));
    }
    const result = yield* Effect.exit(started.value);
    for (const word of words) yield* Fiber.join(word);
    if (this.running === running) {
      this.running = null;
      this.session.turning?.(false);
    }
    const took = yield* Deferred.isDone(taken);
    if (Exit.isFailure(result))
      return yield* Effect.failCause(result.cause).pipe(Effect.mapError((fault) => (took ? heard(fault) : fault)));
    if (!took) return result.value;
    const meta = Predicate.isObject(result.value._meta) ? result.value._meta : {};
    return { ...result.value, _meta: { ...meta, [OPENED]: true } } satisfies PromptResult;
  });

  readonly steer = Effect.fnUntraced(function* (this: Turn, prompt: readonly ContentBlock[], input: string | undefined) {
    const running = this.running;
    if (running?.cancelled === true) return yield* cancelled();
    if (running === null || running.sent) return yield* this.session.steer(prompt, input);
    const done = yield* Deferred.make<Steered, AgentFault>();
    running.early.push({ prompt, input, done });
    return yield* Deferred.await(done);
  });

  readonly withdraw = Effect.fnUntraced(function* (this: Turn, input: string) {
    const early = this.running?.early;
    const index = early?.findIndex((word) => word.input === input) ?? -1;
    if (early !== undefined && index >= 0) {
      const [word] = early.splice(index, 1);
      yield* Deferred.fail(word!.done, cancelled());
      return { withdrawn: true } satisfies Withdrawn;
    }
    if (this.session.withdraw === undefined)
      return yield* new AgentFault({ code: FAULT.methodNotFound, message: 'this agent cannot withdraw words' });
    return yield* this.session.withdraw(input);
  });

  close(): Effect.Effect<void> {
    const running = this.running;
    return running === null || running.sent
      ? Effect.void
      : Effect.asVoid(
          Deferred.fail(running.halted, new AgentFault({ code: FAULT.internal, message: 'this session ended while its turn was opening' })),
        );
  }

  readonly cancel = Effect.fnUntraced(function* (this: Turn) {
    const running = this.running;
    if (running === null) return yield* this.session.cancel();
    running.cancelled = true;
    yield* Deferred.succeed(running.halted, undefined);
    yield* this.session.cancel();
  });
}
