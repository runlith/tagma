import { FFIType, JSCallback } from 'bun:ffi';
import { Data, Effect, Schedule } from 'effect';
import { ChannelFailed } from '../holder/Holder';
import type { Descriptors, ReactorHandle } from './native';

type Interest = 'read' | 'write';
type Waiter = { readonly interest: Interest; readonly resume: (effect: Effect.Effect<void, ChannelFailed>) => void };

const READ = 1n;
const WRITE = 2n;
const ENDED = 4n | 8n;
const PAIRS = 128;
const RETIRE_POLL_MS = 1;

export class ReactorUnavailable extends Data.TaggedError('ReactorUnavailable')<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

const retiredFailure = () => new ChannelFailed({ reason: 'closed', detail: 'the descriptor was closed by this process' });

export class Reactor {
  private readonly waiters = new Map<number, Set<Waiter>>();
  private readonly landing = new BigUint64Array(PAIRS * 2);
  private issued = 0;
  private retired = false;
  private failed: ChannelFailed | undefined;

  private constructor(
    private readonly native: Descriptors,
    private readonly handle: ReactorHandle,
    private readonly callback: JSCallback,
  ) {}

  static open(native: Descriptors): Effect.Effect<Reactor, ReactorUnavailable> {
    return Effect.suspend(() => {
      let opened: Reactor | undefined;
      const callback = new JSCallback(() => opened?.drain(), { args: [], returns: FFIType.void, threadsafe: true });
      const answer = native.openReactor(callback);
      if ('refusal' in answer) {
        callback.close();
        return Effect.fail(new ReactorUnavailable({ detail: answer.detail || answer.refusal }));
      }
      opened = new Reactor(native, answer.reactor, callback);
      return Effect.succeed(opened);
    });
  }

  token(): number {
    this.issued += 1;
    return this.issued;
  }

  wait(fd: number, token: number, interest: Interest): Effect.Effect<void, ChannelFailed> {
    return Effect.callback<void, ChannelFailed>((resume) => {
      if (this.retired || this.failed !== undefined) {
        resume(Effect.fail(this.failed ?? retiredFailure()));
        return;
      }
      const waiter: Waiter = { interest, resume };
      const waiting = this.waiters.get(token) ?? new Set<Waiter>();
      this.waiters.set(token, waiting);
      waiting.add(waiter);
      const armed = this.native.arm(this.handle, fd, token, interest === 'read', interest === 'write');
      if (armed !== undefined) {
        this.remove(token, waiter);
        resume(
          Effect.fail(new ChannelFailed({ reason: armed.refusal === 'closed' ? 'closed' : 'os', detail: armed.detail || armed.refusal })),
        );
        return;
      }
      return Effect.sync(() => this.remove(token, waiter));
    });
  }

  wake(token: number, interest: Interest): void {
    const waiting = this.waiters.get(token);
    if (waiting === undefined) return;
    for (const waiter of [...waiting]) {
      if (waiter.interest !== interest) continue;
      this.remove(token, waiter);
      waiter.resume(Effect.void);
    }
  }

  forget(token: number): void {
    const waiting = this.waiters.get(token);
    this.waiters.delete(token);
    for (const waiter of waiting ?? []) waiter.resume(Effect.fail(retiredFailure()));
  }

  private fail(detail: string): void {
    this.failed = new ChannelFailed({ reason: 'os', detail: `readiness is no longer reported: ${detail}` });
    const waiting = [...this.waiters.values()].flatMap((set) => [...set]);
    this.waiters.clear();
    for (const waiter of waiting) waiter.resume(Effect.fail(this.failed));
  }

  private remove(token: number, waiter: Waiter): void {
    const waiting = this.waiters.get(token);
    if (waiting === undefined) return;
    waiting.delete(waiter);
    if (waiting.size === 0) this.waiters.delete(token);
  }

  private drain(): void {
    for (;;) {
      const taken = this.native.take(this.handle, this.landing);
      if ('refusal' in taken) return this.fail(taken.detail || taken.refusal);
      const pairs = taken.count;
      for (let index = 0; index < pairs; index += 1) {
        const token = Number(this.landing[index * 2]);
        const flags = this.landing[index * 2 + 1]!;
        const waiting = this.waiters.get(token);
        if (waiting === undefined) continue;
        for (const waiter of [...waiting]) {
          const ready = (flags & ENDED) !== 0n || (flags & (waiter.interest === 'read' ? READ : WRITE)) !== 0n;
          if (!ready) continue;
          waiting.delete(waiter);
          waiter.resume(Effect.void);
        }
        if (waiting.size === 0) this.waiters.delete(token);
      }
      if (pairs < PAIRS) return;
    }
  }

  readonly retire = Effect.fn('Reactor.retire')(function* (this: Reactor) {
    this.retired = true;
    for (const token of [...this.waiters.keys()]) this.forget(token);
    const closed = yield* Effect.sync(() => this.native.closeReactor(this.handle)).pipe(
      Effect.repeat({
        while: (closed) => !('refusal' in closed) && closed.state !== 'closed',
        schedule: Schedule.spaced(RETIRE_POLL_MS),
      }),
    );
    if ('refusal' in closed) {
      yield* Effect.logWarning(
        `the descriptor reactor did not retire, so its callback and the native library stay loaded: ${closed.detail || closed.refusal}`,
      );
      return false;
    }
    this.native.disposeReactor(this.handle);
    this.callback.close();
    return true;
  }).call(this);
}
