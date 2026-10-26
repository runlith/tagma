import { Data } from 'effect';

export type FailureReason = 'auth' | 'rate' | 'invalid-request' | 'transport' | 'provider' | 'unsupported' | 'unconfirmed-tail';

export class SpeechFailure extends Data.TaggedError('SpeechFailure')<{
  readonly reason: FailureReason;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number | undefined;
}> {
  static auth(message: string): SpeechFailure {
    return new SpeechFailure({ reason: 'auth', message, retryable: false });
  }

  static rate(message: string, retryAfterMs?: number): SpeechFailure {
    return new SpeechFailure({ reason: 'rate', message, retryable: true, retryAfterMs });
  }

  static invalidRequest(message: string): SpeechFailure {
    return new SpeechFailure({ reason: 'invalid-request', message, retryable: false });
  }

  static transport(message: string): SpeechFailure {
    return new SpeechFailure({ reason: 'transport', message, retryable: true });
  }

  static provider(message: string, retryable: boolean): SpeechFailure {
    return new SpeechFailure({ reason: 'provider', message, retryable });
  }

  static unsupported(message: string): SpeechFailure {
    return new SpeechFailure({ reason: 'unsupported', message, retryable: false });
  }

  static unconfirmedTail(message: string): SpeechFailure {
    return new SpeechFailure({ reason: 'unconfirmed-tail', message, retryable: false });
  }
}

export class Overflow extends Data.TaggedError('Overflow')<{
  readonly budgetFrames: number;
  readonly pendingFrames: number;
}> {}
