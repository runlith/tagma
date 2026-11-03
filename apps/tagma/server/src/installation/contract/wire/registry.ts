import { Data } from 'effect';

export class RegistryUnreadable extends Data.TaggedError('RegistryUnreadable')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.path} is not a readable machine registry (${this.reason}); fix or remove it, and start again`;
  }
}

export class RegistryIncoherent extends Data.TaggedError('RegistryIncoherent')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `the machine registry dumped for ${this.path} would not read back (${this.reason}), so the file keeps its last readable copy`;
  }
}
