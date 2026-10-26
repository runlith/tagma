import { Data, Effect, Schema } from 'effect';
import type { AccountKey, CredentialOrigin } from '../models/authStatus.js';

export type StoredCredential = {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
};

export type CredentialSchema<C extends StoredCredential = StoredCredential> = Schema.Codec<C, C>;

export type AccountRow<C extends StoredCredential = StoredCredential> = {
  readonly key: AccountKey;
  readonly label: string;
  readonly origin: CredentialOrigin;
  readonly addedAt: number;
  readonly credential: C;
};

export type HeldAccount = {
  readonly key: AccountKey;
  readonly aliases?: ReadonlyArray<AccountKey>;
  readonly label: string;
  readonly origin: CredentialOrigin;
  readonly addedAt: number;
  readonly credential: StoredCredential | null;
  readonly unreadable: string | null;
};

export class CredentialInvalid extends Data.TaggedError('CredentialInvalid')<{
  readonly provider: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `The credential does not match the shape "${this.provider}" stores: ${this.detail}`;
  }
}

export function parseStoredCredential<C extends StoredCredential>(
  provider: string,
  schema: CredentialSchema<C>,
  value: unknown,
): Effect.Effect<C, CredentialInvalid> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((issue) => new CredentialInvalid({ provider, detail: issue.message })),
  );
}
