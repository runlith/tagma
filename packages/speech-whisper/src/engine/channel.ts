import { type Cause, Deferred, Effect, Queue } from 'effect';
import { DetectorBehind, EngineCrashed, type EngineFailure, EngineRefused } from './failures.ts';
import { type Command, frame, type Message, type Ready } from './wire.ts';

export type Probs = {
  readonly at: number;
  readonly samples: number;
  readonly probs: ReadonlyArray<number>;
};

type Asked = Extract<Command, { readonly id: string }>;

export class Listener {
  heard = 0;

  constructor(readonly queue: Queue.Queue<Probs, EngineFailure | Cause.Done>) {}

  deliver(probs: Probs): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.heard = probs.at + probs.samples;
      if (Queue.offerUnsafe(this.queue, probs)) return Effect.void;
      return Effect.asVoid(Queue.fail(this.queue, new DetectorBehind({ reason: 'its probabilities were not read in time' })));
    });
  }
}

export class Channel {
  readonly ready: Deferred.Deferred<Ready, EngineFailure>;
  readonly ended: Deferred.Deferred<EngineCrashed>;
  loaded: string | undefined;
  #stderr = '';
  #next = 0;
  readonly #pending = new Map<string, Deferred.Deferred<Message, EngineFailure>>();
  readonly #streams = new Map<string, Listener>();

  constructor(readonly inbox: Queue.Queue<Uint8Array, Cause.Done>) {
    this.ready = Deferred.makeUnsafe<Ready, EngineFailure>();
    this.ended = Deferred.makeUnsafe<EngineCrashed>();
  }

  get alive(): boolean {
    return !Deferred.isDoneUnsafe(this.ended);
  }

  id(): string {
    this.#next += 1;
    return String(this.#next);
  }

  heard(text: string): void {
    this.#stderr = `${this.#stderr}${text}`.slice(-2_048);
  }

  send(command: Command, pcm?: Int16Array): Effect.Effect<void, EngineCrashed> {
    return Effect.suspend(() =>
      this.alive ? Effect.asVoid(Queue.offer(this.inbox, frame(command, pcm))) : Effect.flatMap(Deferred.await(this.ended), Effect.fail),
    );
  }

  ask(command: Asked, pcm?: Int16Array, admitted: Effect.Effect<void, EngineCrashed> = Effect.void): Effect.Effect<Message, EngineFailure> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const answer = Deferred.makeUnsafe<Message, EngineFailure>();
        this.#pending.set(command.id, answer);
        return answer;
      }),
      (answer) => Effect.andThen(this.send(command, pcm), Effect.andThen(admitted, Deferred.await(answer))),
      () => Effect.sync(() => this.#pending.delete(command.id)),
    );
  }

  listen(stream: string, listener: Listener): void {
    this.#streams.set(stream, listener);
  }

  forget(stream: string): void {
    this.#streams.delete(stream);
  }

  route(message: Message): Effect.Effect<void> {
    return Effect.suspend(() => {
      switch (message.type) {
        case 'ready':
          return Deferred.succeed(this.ready, message);
        case 'vad.probs': {
          const listener = this.#streams.get(message.stream);
          const probs: Probs = { at: message.at, samples: message.samples, probs: message.probs };
          return listener === undefined ? Effect.void : listener.deliver(probs);
        }
        case 'error':
          return this.refuse(message.code, message.message, message.id, message.stream);
        default:
          return this.answer(message.id, message);
      }
    });
  }

  end(reason: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (!this.alive) return Effect.void;
      const told = this.#stderr.trim();
      const crashed = new EngineCrashed({ reason: told === '' ? reason : `${reason}: ${told}` });
      const pending = [...this.#pending.values()];
      const streams = [...this.#streams.values()];
      this.#pending.clear();
      this.#streams.clear();
      this.loaded = undefined;
      return Effect.all(
        [
          Deferred.succeed(this.ended, crashed),
          Deferred.fail(this.ready, crashed),
          Queue.end(this.inbox),
          ...pending.map((answer) => Deferred.fail(answer, crashed)),
          ...streams.map((listener) => Queue.fail(listener.queue, crashed)),
        ],
        { discard: true },
      );
    });
  }

  private answer(id: string, message: Message): Effect.Effect<void> {
    const answer = this.#pending.get(id);
    return answer === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(answer, message));
  }

  private refuse(code: string, reason: string, id: string | undefined, stream: string | undefined): Effect.Effect<void> {
    if (id === undefined && stream === undefined) return this.end(`it refused the channel (${code}): ${reason}`);
    const refused = new EngineRefused({ code, reason });
    const answer = id === undefined ? undefined : this.#pending.get(id);
    const listener = stream === undefined ? undefined : this.#streams.get(stream);
    return Effect.all(
      [
        answer === undefined ? Effect.void : Deferred.fail(answer, refused),
        listener === undefined ? Effect.void : Queue.fail(listener.queue, refused),
      ],
      { discard: true },
    );
  }
}
