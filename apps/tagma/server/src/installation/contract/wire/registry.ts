import { Data } from 'effect';

export class RegistryUnreadable extends Data.TaggedError('RegistryUnreadable')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.path} is not a readable machine registry (${this.reason}); fix or remove it, and start again`;
  }
}
