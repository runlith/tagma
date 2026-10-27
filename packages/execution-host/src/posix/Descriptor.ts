import { Effect } from 'effect';
import { TRANSFER_LIMIT } from '@runlith/executions/protocol/capacity';
import { ChannelFailed, ForegroundRefused, TerminalInterruptRefused, type PendingEcho } from '../holder/Holder';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { Descriptors, TerminalFacts } from './native';
import type { Refused } from './refusal';
import type { Reactor } from './Reactor';

const failure = (refused: Refused): ChannelFailed =>
  new ChannelFailed({
    reason: refused.refusal === 'closed' ? 'closed' : refused.refusal === 'gone' ? 'gone' : 'os',
    detail: refused.detail || refused.refusal,
  });

const closedFailure = () => new ChannelFailed({ reason: 'closed', detail: 'the descriptor was closed by this process' });

const stoppedFailure = (act: 'reading' | 'writing') =>
  new ChannelFailed({ reason: 'stopped', detail: `${act} was stopped on this descriptor before it took a byte` });

export class Descriptor {
  private open = true;
  private ended = false;
  private reading = true;
  private writing = true;
  private landing: Uint8Array | undefined;
  private readonly echoes: PendingEcho[] = [];
  private echoHead = 0;
  private readBytes = 0;
  private readonly token: number;

  constructor(
    private readonly native: Descriptors,
    private readonly reactor: Reactor,
    readonly fd: number,
  ) {
    this.token = reactor.token();
  }

  readonly read = Effect.fnUntraced(function* (this: Descriptor, limit = TRANSFER_LIMIT) {
    for (;;) {
      const echo = this.echoes[this.echoHead];
      if (echo !== undefined && echo.after <= this.readBytes) {
        const taken = echo.bytes.subarray(0, limit);
        if (taken.length < echo.bytes.length) this.echoes[this.echoHead] = { ...echo, bytes: echo.bytes.subarray(taken.length) };
        else {
          this.echoHead += 1;
          if (this.echoHead === this.echoes.length) {
            this.echoes.length = 0;
            this.echoHead = 0;
          }
        }
        return taken;
      }
      if (this.ended) return undefined;
      if (!this.open) return yield* closedFailure();
      if (!this.reading) return yield* stoppedFailure('reading');
      this.landing ??= new Uint8Array(TRANSFER_LIMIT);
      const ceiling = Math.min(TRANSFER_LIMIT, limit);
      const landing = this.landing.subarray(0, echo === undefined ? ceiling : Math.min(ceiling, echo.after - this.readBytes));
      const answer = this.native.read(this.fd, landing);
      if ('count' in answer) {
        if (answer.count !== 0) {
          this.readBytes += answer.count;
          return this.landing.slice(0, answer.count);
        }
        this.ended = true;
        this.close();
        return undefined;
      }
      if (answer.refusal !== 'would-block') return yield* failure(answer);
      yield* this.reactor.wait(this.fd, this.token, 'read');
    }
  }).bind(this);

  readonly write = Effect.fnUntraced(function* (this: Descriptor, bytes: Uint8Array) {
    if (bytes.length === 0) return 0;
    const head = bytes.length > TRANSFER_LIMIT ? bytes.subarray(0, TRANSFER_LIMIT) : bytes;
    for (;;) {
      if (!this.open) return yield* closedFailure();
      if (!this.writing) return yield* stoppedFailure('writing');
      const answer = this.native.write(this.fd, head);
      if ('count' in answer) return answer.count;
      if (answer.refusal === 'gone') return yield* new ChannelFailed({ reason: 'closed', detail: 'the channel has no reader' });
      if (answer.refusal !== 'would-block') return yield* failure(answer);
      yield* this.reactor.wait(this.fd, this.token, 'write');
    }
  });

  readonly stopReading: Effect.Effect<void> = Effect.sync(() => {
    this.reading = false;
    this.reactor.wake(this.token, 'read');
  });

  readonly pendingEchoes: Effect.Effect<ReadonlyArray<PendingEcho>> = Effect.sync(() =>
    this.echoes.slice(this.echoHead).map((echo) => ({ ...echo, after: Math.max(0, echo.after - this.readBytes) })),
  );

  owe(echoes: ReadonlyArray<PendingEcho>): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const echo of echoes) this.echoes.push({ ...echo, after: this.readBytes + echo.after });
      if (echoes.length > 0) this.reactor.wake(this.token, 'read');
    });
  }

  readonly stopWriting: Effect.Effect<void> = Effect.sync(() => {
    this.writing = false;
    this.reactor.wake(this.token, 'write');
  });

  readonly receive = Effect.fnUntraced(function* (this: Descriptor, landing: Uint8Array, slots: Int32Array) {
    for (;;) {
      if (!this.open) return yield* closedFailure();
      const answer = this.native.receive(this.fd, landing, slots);
      if ('count' in answer) return answer;
      if (answer.refusal !== 'would-block') return yield* failure(answer);
      yield* this.reactor.wait(this.fd, this.token, 'read');
    }
  });

  resize(rows: number, cols: number): Effect.Effect<void, ChannelFailed> {
    return Effect.suspend(() => {
      if (!this.open) return Effect.fail(closedFailure());
      const refused = this.native.resize(this.fd, rows, cols);
      return refused === undefined ? Effect.void : Effect.fail(failure(refused));
    });
  }

  readonly size = Effect.map(this.facts(0), ({ rows, cols }) => ({ rows, cols }));

  readonly foreground: Effect.Effect<ProcessWitness, ForegroundRefused> = Effect.suspend(() => {
    if (!this.open) return Effect.fail(new ForegroundRefused({ reason: 'no-terminal', detail: 'the terminal was closed' }));
    const answer = this.native.foreground(this.fd);
    return 'pid' in answer
      ? Effect.succeed(answer)
      : Effect.fail(new ForegroundRefused({ reason: 'unreadable', detail: answer.detail || answer.refusal }));
  });

  readonly interrupt = Effect.fnUntraced(function* (this: Descriptor, onFlush?: () => void) {
    const facts = yield* this.facts(0);
    if (!facts.isig) return yield* new TerminalInterruptRefused({ reason: 'isig-disabled', detail: 'the terminal has ISIG switched off' });
    if (facts.interrupt <= 0 || facts.interrupt >= 0xff)
      return yield* new TerminalInterruptRefused({
        reason: 'no-character',
        detail: `VINTR ${facts.interrupt} names no interrupt character`,
      });
    const written = facts.external ? { count: 0 } : this.native.write(this.fd, Uint8Array.of(facts.interrupt));
    if ('count' in written && written.count > 0) {
      if (!facts.noFlush) this.flushed(onFlush);
      return written.count;
    }
    if ('refusal' in written && written.refusal !== 'would-block') return yield* failure(written);
    const signalled = this.native.interrupt(this.fd);
    if ('refusal' in signalled) return yield* failure(signalled);
    if (!facts.noFlush) this.flushed(onFlush);
    if (facts.echo && !facts.external) {
      this.echoes.push({
        after: this.readBytes + (facts.noFlush ? signalled.count : 0),
        bytes:
          facts.echoControl && (facts.interrupt < 32 || facts.interrupt === 127)
            ? Uint8Array.of(94, facts.interrupt ^ 64)
            : Uint8Array.of(facts.interrupt),
      });
      this.reactor.wake(this.token, 'read');
    }
    return 1;
  });
  private flushed(onFlush: (() => void) | undefined): void {
    onFlush?.();
    const output = this.echoes.slice(this.echoHead).filter((echo) => echo.output === true);
    this.echoes.length = 0;
    this.echoes.push(...output);
    this.echoHead = 0;
  }

  facts(pid: number): Effect.Effect<TerminalFacts, ChannelFailed> {
    return Effect.suspend(() => {
      if (!this.open) return Effect.fail(closedFailure());
      const answer = this.native.terminal(this.fd, pid);
      return 'facts' in answer ? Effect.succeed(answer.facts) : Effect.fail(failure(answer));
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.reactor.forget(this.token);
    this.native.close(this.fd);
  }
}
