import { Deferred, Effect } from 'effect';
import type { MarkOutcome } from '../port/player.ts';
import { DeviceRefused } from '../port/refusal.ts';
import type { Format } from '../sound/format.ts';
import type { EndReason } from '../sound/track.ts';
import { Unexpected } from './capture.ts';

export class Playback extends Unexpected {
  protected readonly kind = 'player';
  private open = false;
  private outstanding = 0;
  private waiter: Deferred.Deferred<void> | undefined;
  private readonly marks = new Map<string, Array<Deferred.Deferred<MarkOutcome>>>();
  private stopped: DeviceRefused | undefined;
  private refusal = false;

  constructor(
    readonly opened: Deferred.Deferred<void, DeviceRefused>,
    private readonly capacityMs: number,
  ) {
    super();
  }

  get failure(): DeviceRefused | undefined {
    return this.stopped;
  }

  get refusedAtOpen(): boolean {
    return this.refusal;
  }

  fits(ms: number): boolean {
    return this.outstanding === 0 || this.outstanding + ms <= this.capacityMs;
  }

  reserve(ms: number): void {
    this.outstanding += ms;
  }

  room(ms: number): Effect.Effect<void, DeviceRefused> {
    return Effect.suspend(() => {
      if (this.stopped !== undefined) return Effect.fail(this.stopped);
      if (this.fits(ms)) return Effect.void;
      const waiter = (this.waiter ??= Deferred.makeUnsafe<void>());
      return Deferred.await(waiter).pipe(Effect.andThen(this.room(ms)));
    });
  }

  close(): void {
    this.stopped ??= new DeviceRefused({ code: 'device-failed', message: 'the player was released', unblock: [] });
    this.wake();
  }

  expect(mark: string): Deferred.Deferred<MarkOutcome> {
    const outcome = Deferred.makeUnsafe<MarkOutcome>();
    const queue = this.marks.get(mark);
    if (queue === undefined) this.marks.set(mark, [outcome]);
    else queue.push(outcome);
    return outcome;
  }

  override ready(format: Format | undefined): string | undefined {
    if (this.open) return 'a second ready for a player';
    if (format !== undefined) return 'a player ready carries a format';
    this.open = true;
    Deferred.doneUnsafe(this.opened, Effect.void);
    return undefined;
  }

  override refused(refusal: DeviceRefused): string | undefined {
    if (this.open) return 'refused after ready';
    this.stopped = refusal;
    this.refusal = true;
    Deferred.doneUnsafe(this.opened, Effect.fail(refusal));
    return undefined;
  }

  override played(ms: number): string | undefined {
    if (!this.open) return 'played before ready';
    this.outstanding = Math.max(0, this.outstanding - ms);
    this.wake();
    return undefined;
  }

  override marked(mark: string, outcome: MarkOutcome): string | undefined {
    const pending = this.marks.get(mark)?.shift();
    if (pending === undefined) return `an outcome for unknown mark ${mark}`;
    if (this.marks.get(mark)?.length === 0) this.marks.delete(mark);
    Deferred.doneUnsafe(pending, Effect.succeed(outcome));
    return undefined;
  }

  override end(reason: EndReason): string | undefined {
    if (!this.open) return 'end before ready';
    const message = reason === 'released' ? 'the player was released' : `the output device ended: ${reason}`;
    this.stop(new DeviceRefused({ code: 'device-failed', message, unblock: [] }));
    return undefined;
  }

  lost(_now: bigint, failure: DeviceRefused): void {
    if (!this.open) {
      this.stopped = failure;
      this.refusal = true;
      Deferred.doneUnsafe(this.opened, Effect.fail(failure));
      return;
    }
    this.stop(failure);
  }

  private stop(failure: DeviceRefused): void {
    this.stopped ??= failure;
    for (const queue of this.marks.values()) {
      for (const outcome of queue) Deferred.doneUnsafe(outcome, Effect.succeed('cleared'));
    }
    this.marks.clear();
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter !== undefined) Deferred.doneUnsafe(waiter, Effect.void);
  }
}
