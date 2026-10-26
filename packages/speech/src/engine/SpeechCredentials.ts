import { Context, Data, type Effect } from 'effect';

export class CredentialRefused extends Data.TaggedError('CredentialRefused')<{
  readonly provider: string;
  readonly code: string;
  readonly message: string;
  readonly unblock: ReadonlyArray<string>;
  readonly retryable: boolean;
}> {}

export class SpeechCredentials extends Context.Service<
  SpeechCredentials,
  {
    readonly get: (provider: string, account?: string) => Effect.Effect<unknown, CredentialRefused>;
  }
>()('speech/SpeechCredentials') {}
