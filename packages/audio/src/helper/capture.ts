import { type Cause, Deferred, Effect, Queue, Stream } from 'effect';
import type { MarkOutcome } from '../port/player.ts';
import type { DeviceRefused } from '../port/refusal.ts';
import { chunk } from '../sound/chunk.ts';
import { type Format, nanosOf } from '../sound/format.ts';
import { type Gap, gap } from '../sound/gap.ts';
import { type EndReason, ended, type Sound } from '../sound/track.ts';
import type { Resource } from './session.ts';

export abstract class Unexpected implements Resource {
  protected abstract readonly kind: string;
  ready(_format: Format | undefined): string | undefined {
    return `ready for a ${this.kind}`;
  }
  refused(_refusal: DeviceRefused): string | undefined {
    return `refused for a ${this.kind}`;
  }
  gap(_gap: Gap): string | undefined {
    return `gap for a ${this.kind}`;
  }
  end(_reason: EndReason): string | undefined {
    return `end for a ${this.kind}`;
  }
  played(_ms: number): string | undefined {
    return `played for a ${this.kind}`;
  }
  marked(_mark: string, _outcome: MarkOutcome): string | undefined {
    return `marked for a ${this.kind}`;
  }
  audio(_at: bigint, _pcm: Int16Array): string | undefined {
    return `audio for a ${this.kind}`;
  }
  abstract lost(now: bigint, failure: DeviceRefused): void;
}

export class Capture extends Unexpected {
  protected readonly kind = 'capture';
  private format: Format | undefined;
  private limit = 0;
  private buffered = 0;
  private reach: bigint | undefined;
  private overflow: { from: bigint; to: bigint } | undefined;
  private closed = false;
  private discarded = false;

  constructor(
    readonly opened: Deferred.Deferred<Format, DeviceRefused>,
    private readonly queue: Queue.Queue<Sound, Cause.Done>,
    private readonly bufferMs: number,
  ) {
    super();
  }

  get done(): boolean {
    return this.closed;
  }

  get chunks(): Stream.Stream<Sound> {
    return Stream.fromQueue(this.queue).pipe(
      Stream.map((sound) => {
        if (sound._tag === 'Chunk' && this.format !== undefined) this.buffered -= sound.pcm.length / this.format.channels;
        return sound;
      }),
    );
  }

  override ready(format: Format | undefined): string | undefined {
    if (this.format !== undefined) return 'a second ready for a capture';
    if (format === undefined) return 'a capture ready without its format';
    this.format = format;
    this.limit = Math.ceil((this.bufferMs * format.rate) / 1000);
    Deferred.doneUnsafe(this.opened, Effect.succeed(format));
    return undefined;
  }

  override refused(refusal: DeviceRefused): string | undefined {
    if (this.format !== undefined) return 'refused after ready';
    this.closed = true;
    Deferred.doneUnsafe(this.opened, Effect.fail(refusal));
    return undefined;
  }

  get discard(): Effect.Effect<void> {
    return Effect.suspend(() => {
      this.discarded = true;
      this.overflow = undefined;
      return Queue.clear(this.queue).pipe(Effect.andThen(Queue.end(this.queue)), Effect.asVoid);
    });
  }

  override audio(at: bigint, pcm: Int16Array): string | undefined {
    const format = this.format;
    if (format === undefined || this.closed) return 'audio outside an open capture';
    if (pcm.length % format.channels !== 0) return 'a chunk of partial frames';
    if (this.discarded) return undefined;
    const frames = pcm.length / format.channels;
    const to = at + nanosOf(format, frames);
    this.reach = to;
    if (this.buffered + frames > this.limit) {
      this.overflow = { from: this.overflow?.from ?? at, to };
      return undefined;
    }
    this.flushOverflow();
    this.buffered += frames;
    Queue.offerUnsafe(this.queue, chunk(format, at, pcm));
    return undefined;
  }

  override gap(next: Gap): string | undefined {
    if (this.format === undefined || this.closed) return 'gap outside an open capture';
    if (this.discarded) return undefined;
    this.flushOverflow();
    if (next.to !== undefined) this.reach = next.to;
    Queue.offerUnsafe(this.queue, next);
    return undefined;
  }

  override end(reason: EndReason): string | undefined {
    if (this.closed) return 'end after the capture closed';
    if (this.format === undefined) return 'end before ready';
    this.finish(reason);
    return undefined;
  }

  lost(now: bigint, failure: DeviceRefused): void {
    if (this.closed) return;
    if (this.format === undefined) {
      this.closed = true;
      Deferred.doneUnsafe(this.opened, Effect.fail(failure));
      return;
    }
    if (!this.discarded) {
      this.flushOverflow();
      Queue.offerUnsafe(this.queue, gap(this.reach ?? now, undefined, 'helper-failed'));
    }
    this.finish('helper-lost');
  }

  private finish(reason: EndReason): void {
    this.closed = true;
    if (this.discarded) return;
    this.flushOverflow();
    Queue.offerUnsafe(this.queue, ended(reason));
    Queue.endUnsafe(this.queue);
  }

  private flushOverflow(): void {
    if (this.overflow === undefined) return;
    Queue.offerUnsafe(this.queue, gap(this.overflow.from, this.overflow.to, 'overflow'));
    this.overflow = undefined;
  }
}
