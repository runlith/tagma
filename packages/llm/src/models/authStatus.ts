import { Schema } from 'effect';

export const AccountKey = Schema.String.pipe(Schema.brand('LLM.AccountKey'));
export type AccountKey = typeof AccountKey.Type;

export const CredentialOrigin = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('own') }),
  Schema.Struct({ kind: Schema.Literal('cli'), place: Schema.String, shown: Schema.String, made: Schema.Boolean }),
]);
export type CredentialOrigin = typeof CredentialOrigin.Type;

export type AuthStatus = {
  readonly account: AccountKey;
  readonly provider: string;
  readonly label: string;
  readonly organization?: string;
  readonly expiresAt: number | null;
  readonly origin: CredentialOrigin;
  readonly addedAt: number;
};

export type ProviderSignInBegin = { flow: 'device'; authorizeUrl: string; userCode: string };
