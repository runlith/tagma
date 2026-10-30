import { Deferred, Effect } from 'effect';
import type { Outbound, Receipt } from '@runlith/acp/events';
import type { SessionParams } from '@runlith/acp/methods';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';

import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { HarnessLanes } from '../sessions/lanes.js';
import { COMPACT, STEER, WITHDRAW } from '@runlith/hosted-runner/wire/extensions';
import { writeFrame, type Written } from './link.js';

export type Cancel = {
  readonly params: SessionParams;
  readonly turns: Set<string>;
  by: ThreadRunStoppedBy | null;
  written: Written | null;
};

export type Landing =
  | { readonly _tag: 'Frame'; readonly receipt: Receipt | null; readonly written: Written }
  | { readonly _tag: 'Cancel'; readonly cancel: Cancel; readonly written: Written };

type Queued = { readonly outbound: Outbound; readonly epoch: number };

type Flight =
  | { readonly _tag: 'Frame'; readonly item: Queued; readonly cut: Deferred.Deferred<void> | null }
  | { readonly _tag: 'Cancel'; readonly cancel: Cancel };

const TURN_METHODS: ReadonlySet<string> = new Set(['session/prompt', STEER, WITHDRAW, COMPACT]);

const ofTurn = ({ envelope, receipt }: Outbound): boolean =>
  receipt?._tag === 'Answer' || (envelope._tag === 'Request' && TURN_METHODS.has(envelope.method));

export const cancels = ({ envelope }: Outbound): boolean => envelope._tag === 'Notification' && envelope.method === 'session/cancel';

const UNSENT: Written = { _tag: 'Unwritten', reason: 'a cancel came before this frame was written', poisoned: false };

const UNSETTLED: Written = { _tag: 'Unknown', reason: 'the process ended before its input write was settled', poisoned: false };

const UNCANCELLED: Written = { _tag: 'Unwritten', reason: 'the process ended before the cancel was written', poisoned: false };

const stops = (written: Written): boolean => written._tag !== 'Admitted' && written.poisoned;

export class ProtocolWriter {
  private epoch = 0;
  private readonly urgent: (Queued | Cancel)[] = [];
  private readonly frames: Queued[] = [];
  private readonly landings: Landing[] = [];
  private flight: Flight | null = null;
  private torn: Landing | null = null;
  private writable: Deferred.Deferred<void> | null = null;
  private reportable: Deferred.Deferred<void> | null = null;

  constructor(
    private readonly input: TerminalWriting['Service'],
    private readonly lanes: HarnessLanes,
    private readonly sessionId: string,
  ) {}

  static make(input: TerminalWriting['Service'], lanes: HarnessLanes, sessionId: string): Effect.Effect<ProtocolWriter> {
    return Effect.sync(() => new ProtocolWriter(input, lanes, sessionId));
  }

  unsettled(): readonly Landing[] {
    const flying: readonly Landing[] =
      this.flight === null
        ? []
        : this.flight._tag === 'Frame'
          ? [{ _tag: 'Frame', receipt: this.flight.item.outbound.receipt, written: UNSETTLED }]
          : [{ _tag: 'Cancel', cancel: this.flight.cancel, written: UNSETTLED }];
    const unsent = this.urgent.flatMap((item): readonly Landing[] =>
      'turns' in item ? [{ _tag: 'Cancel', cancel: item, written: UNCANCELLED }] : [],
    );
    return [...flying, ...(this.torn === null ? [] : [this.torn]), ...unsent];
  }

  take(): Landing | undefined {
    return this.landings.shift();
  }

  generation(): number {
    return this.epoch;
  }

  readonly enqueue = Effect.fnUntraced(function* (this: ProtocolWriter, frames: readonly Outbound[], epoch = this.epoch) {
    for (const outbound of frames) {
      if (cancels(outbound)) this.cut({ outbound, epoch: this.epoch + 1 });
      else this.frames.push({ outbound, epoch });
    }
    this.wake();
  });

  cancel(params: SessionParams, turns: readonly string[], by: ThreadRunStoppedBy | null): Cancel {
    const standing = this.urgent.find((item): item is Cancel => 'turns' in item);
    if (standing !== undefined) {
      for (const turn of turns) standing.turns.add(turn);
      standing.by ??= by;
      return standing;
    }
    const cancel: Cancel = { params, turns: new Set(turns), by, written: null };
    this.cut(cancel);
    this.wake();
    return cancel;
  }

  drive(settle: Effect.Effect<void, HarnessFailure>): Effect.Effect<void, HarnessFailure> {
    return Effect.raceFirst(this.writing(), this.reporting(settle));
  }

  private cut(cancel: Queued | Cancel): void {
    this.epoch += 1;
    this.urgent.push(cancel);
    if (this.flight?._tag === 'Frame' && this.flight.cut !== null) Deferred.doneUnsafe(this.flight.cut, Effect.void);
  }

  private wake(): void {
    const waiting = this.writable;
    this.writable = null;
    if (waiting !== null) Deferred.doneUnsafe(waiting, Effect.void);
  }

  private land(landing: Landing): void {
    this.landings.push(landing);
    const waiting = this.reportable;
    this.reportable = null;
    if (waiting !== null) Deferred.doneUnsafe(waiting, Effect.void);
  }

  private landed(landing: Landing): boolean {
    this.land(landing);
    if (this.torn !== null) this.land(this.torn);
    this.torn = null;
    return stops(landing.written);
  }

  private frameOf(item: Queued, transfer: Written): Landing {
    const receipt = item.outbound.receipt;
    const written =
      receipt === null && (transfer._tag === 'Refused' || transfer._tag === 'Unknown') ? { ...transfer, poisoned: true } : transfer;
    return { _tag: 'Frame', receipt, written };
  }

  private readonly writing = Effect.fnUntraced(function* (this: ProtocolWriter) {
    const { input, lanes, sessionId } = this;
    while (true) {
      const next = this.urgent.shift() ?? this.frames.shift();
      if (next === undefined) {
        yield* Deferred.await((this.writable ??= Deferred.makeUnsafe<void>()));
        continue;
      }
      if ('turns' in next) {
        this.flight = { _tag: 'Cancel', cancel: next };
        const envelope = { _tag: 'Notification', method: 'session/cancel', params: next.params } as const;
        const transfer = yield* writeFrame(input, lanes, sessionId, envelope, null);
        this.flight = null;
        const written: Written =
          transfer._tag === 'Untaken'
            ? UNCANCELLED
            : transfer._tag === 'Refused' || transfer._tag === 'Unknown'
              ? { ...transfer, poisoned: true }
              : transfer;
        if (this.landed({ _tag: 'Cancel', cancel: next, written })) return yield* Effect.never;
        continue;
      }
      if (next.epoch < this.epoch && ofTurn(next.outbound)) {
        this.land(this.frameOf(next, UNSENT));
        continue;
      }
      const cut = cancels(next.outbound) ? null : Deferred.makeUnsafe<void>();
      this.flight = { _tag: 'Frame', item: next, cut };
      const transfer = yield* writeFrame(input, lanes, sessionId, next.outbound.envelope, cut, ofTurn(next.outbound));
      this.flight = null;
      if (transfer._tag === 'Untaken') {
        if (ofTurn(next.outbound)) this.torn = this.frameOf(next, UNSENT);
        else this.frames.unshift({ outbound: next.outbound, epoch: this.epoch });
        continue;
      }
      const landing = this.frameOf(next, transfer);
      if (cut !== null && Deferred.isDoneUnsafe(cut) && transfer._tag !== 'Admitted' && !stops(landing.written)) {
        this.torn = landing;
        continue;
      }
      if (this.landed(landing)) return yield* Effect.never;
    }
  });

  private readonly reporting = Effect.fnUntraced(function* (this: ProtocolWriter, settle: Effect.Effect<void, HarnessFailure>) {
    while (true) {
      if (this.landings.length === 0) yield* Deferred.await((this.reportable ??= Deferred.makeUnsafe<void>()));
      else yield* settle;
    }
  });
}
