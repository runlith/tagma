import { Data } from 'effect';

export class ModelUnknown extends Data.TaggedError('ModelUnknown')<{
  readonly model: string;
}> {
  override get message(): string {
    return `No Whisper model is named ${this.model}.`;
  }
}

export class ModelMissing extends Data.TaggedError('ModelMissing')<{
  readonly model: string;
}> {
  override get message(): string {
    return `Whisper model ${this.model} is not installed.`;
  }
}

export class InstallBusy extends Data.TaggedError('InstallBusy')<{
  readonly installing: string;
}> {
  override get message(): string {
    return `Whisper model ${this.installing} is being installed.`;
  }
}

export class DownloadFailed extends Data.TaggedError('DownloadFailed')<{
  readonly model: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Whisper model ${this.model} could not be downloaded: ${this.reason}`;
  }
}

export class IntegrityFailed extends Data.TaggedError('IntegrityFailed')<{
  readonly model: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Whisper model ${this.model} failed verification: ${this.reason}`;
  }
}

export class StoreFailed extends Data.TaggedError('StoreFailed')<{
  readonly reason: string;
}> {
  override get message(): string {
    return `The Whisper model store failed: ${this.reason}`;
  }
}

export type InstallFailure = ModelUnknown | InstallBusy | DownloadFailed | IntegrityFailed | StoreFailed;
