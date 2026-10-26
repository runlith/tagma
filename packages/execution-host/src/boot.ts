import { Data } from 'effect';

export class BootRefused extends Data.TaggedError('BootRefused')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}
