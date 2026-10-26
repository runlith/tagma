import { Data } from 'effect';

export type HoldSite = { readonly resource: string; readonly rank: number; readonly key: string; readonly stack: string };

export class LockOrderViolated extends Data.TaggedError('LockOrderViolated')<{
  readonly wanted: HoldSite;
  readonly held: HoldSite;
}> {
  override get message(): string {
    return `lock-order: ${this.wanted.resource} ${this.wanted.key} at rank ${this.wanted.rank} was asked for while ${this.held.resource} ${this.held.key} at rank ${this.held.rank} is held\nwanted at:\n${this.wanted.stack}\nheld since:\n${this.held.stack}`;
  }
}

export class WaitUnderHold extends Data.TaggedError('WaitUnderHold')<{
  readonly waitingOn: string;
  readonly holding: readonly string[];
}> {
  override get message(): string {
    return `${this.waitingOn} was waited on while holding ${this.holding.join(', ')}`;
  }
}

export class ResourceInvalid extends Data.TaggedError('ResourceInvalid')<{
  readonly resource: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.resource} cannot be declared: ${this.reason}`;
  }
}

export class HoldStalled extends Data.TaggedError('HoldStalled')<{
  readonly resource: string;
  readonly key: string;
  readonly outcome: 'none';
  readonly waitedMs: number;
}> {
  override get message(): string {
    return `${this.resource} ${this.key} was waited on for ${Math.round(this.waitedMs)} ms, the longest this act may wait, and the act stopped waiting without its outcome`;
  }
}

export class HoldCut extends Data.TaggedError('HoldCut')<{
  readonly resource: string;
  readonly key: string;
  readonly leaves: string;
  readonly heldMs: number;
}> {
  override get message(): string {
    return `${this.resource} ${this.key} was held ${Math.round(this.heldMs)} ms, past its ceiling, and the act holding it was cut: ${this.leaves}`;
  }
}

export class ReentrantCall extends Data.TaggedError('ReentrantCall')<{
  readonly resource: string;
  readonly key: string;
}> {
  override get message(): string {
    return `${this.resource} ${this.key} was asked for again by the work already holding it`;
  }
}

export class CapacityBusy extends Data.TaggedError('CapacityBusy')<{
  readonly phase: string;
  readonly pools: readonly string[];
  readonly expectedMs: number;
}> {
  override get message(): string {
    return `${this.phase} was refused: about ${Math.round(this.expectedMs)} ms of work stands ahead of it in ${this.pools.join(', ')}`;
  }
}
