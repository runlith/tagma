import { Deferred, Effect } from 'effect';
import type { DeviceRefused } from '../port/refusal.ts';
import type { Format } from '../sound/format.ts';
import type { EndReason } from '../sound/track.ts';
import { Unexpected } from './capture.ts';

export class Hold extends Unexpected {
  protected readonly kind = 'mute holder';
  private open = false;
  private refusal = false;

  constructor(readonly opened: Deferred.Deferred<void, DeviceRefused>) {
    super();
  }

  get refusedAtOpen(): boolean {
    return this.refusal;
  }

  override ready(format: Format | undefined): string | undefined {
    if (this.open) return 'a second ready for a mute holder';
    if (format !== undefined) return 'a mute ready carries a format';
    this.open = true;
    Deferred.doneUnsafe(this.opened, Effect.void);
    return undefined;
  }

  override refused(refusal: DeviceRefused): string | undefined {
    if (this.open) return 'refused after ready';
    this.refusal = true;
    Deferred.doneUnsafe(this.opened, Effect.fail(refusal));
    return undefined;
  }

  override end(_reason: EndReason): string | undefined {
    return this.open ? undefined : 'end before ready';
  }

  lost(_now: bigint, failure: DeviceRefused): void {
    if (this.open) return;
    this.refusal = true;
    Deferred.doneUnsafe(this.opened, Effect.fail(failure));
  }
}
