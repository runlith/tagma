import { Data } from 'effect';

export class EngineUnavailable extends Data.TaggedError('EngineUnavailable')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `The Whisper engine could not start: ${this.reason}`;
  }
}

export class EngineCrashed extends Data.TaggedError('EngineCrashed')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `The Whisper engine stopped: ${this.reason}`;
  }
}

export class EngineRefused extends Data.TaggedError('EngineRefused')<{
  readonly code: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `The Whisper engine refused (${this.code}): ${this.reason}`;
  }
}

export class QueueFull extends Data.TaggedError('QueueFull')<{
  readonly queuedMs: number;
  readonly budgetMs: number;
}> {
  override get message(): string {
    return `The Whisper queue holds ${Math.round(this.queuedMs)} ms of audio and takes at most ${this.budgetMs} ms.`;
  }
}

export class ModelBusy extends Data.TaggedError('ModelBusy')<{
  readonly working: string;
  readonly requested: string;
}> {
  override get message(): string {
    return `The Whisper engine is working with ${this.working}; ${this.requested} waits until it is idle.`;
  }
}

export class DetectorBehind extends Data.TaggedError('DetectorBehind')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `The speech detector fell behind: ${this.reason}`;
  }
}

export type EngineFailure = EngineUnavailable | EngineCrashed | EngineRefused | DetectorBehind;
