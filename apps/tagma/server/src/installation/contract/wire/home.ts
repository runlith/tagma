import { Data } from 'effect';

export type HomeVariable = 'TAGMA_DATABASE_PATH' | 'TAGMA_INSTALL_ROOT';

export class HomeUnavailable extends Data.TaggedError('HomeUnavailable')<{
  readonly variable: HomeVariable;
}> {
  override get message(): string {
    return `${this.variable} is required when HOME is unavailable.`;
  }
}
