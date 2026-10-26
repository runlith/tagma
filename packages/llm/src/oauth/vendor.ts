import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import type { AccountKey } from '../models/authStatus.js';
import type { CredentialSchema, StoredCredential } from './credential.js';
import type { DeviceGrantTokens, DeviceGrantVendor } from './flows/deviceGrant.js';

export type SignInMethod = 'loopback' | 'device' | 'paste' | 'key' | 'external-cli';

type NeedsWire = HttpClient.HttpClient;

export type FlowFailure = { readonly message: string };

export type LoopbackSignIn<C extends StoredCredential> = {
  readonly kind: 'loopback';
  readonly run: (openBrowser: (authorizeUrl: string) => void) => Effect.Effect<C, FlowFailure, NeedsWire>;
};

export type DeviceSignIn<C extends StoredCredential> = {
  readonly kind: 'device';
  readonly vendor: DeviceGrantVendor;
  readonly store: (tokens: DeviceGrantTokens) => Effect.Effect<C, FlowFailure, NeedsWire>;
};

export type PasteChallenge<C extends StoredCredential> = {
  readonly authorizeUrl: string;
  readonly complete: (code: string) => Effect.Effect<C, FlowFailure, NeedsWire>;
};

export type PasteSignIn<C extends StoredCredential> = {
  readonly kind: 'paste';
  readonly begin: () => Effect.Effect<PasteChallenge<C>, FlowFailure, NeedsWire>;
};

export type KeySignIn<C extends StoredCredential> = {
  readonly kind: 'key';
  readonly store: (key: string) => Effect.Effect<C, FlowFailure, NeedsWire>;
};

export type SubscriptionSignIn<C extends StoredCredential = StoredCredential> =
  | LoopbackSignIn<C>
  | DeviceSignIn<C>
  | PasteSignIn<C>
  | KeySignIn<C>;

export type SubscriptionAccounts<C extends StoredCredential = StoredCredential> = {
  readonly credential: CredentialSchema<C>;
  readonly signIns: readonly SubscriptionSignIn<C>[];
  readonly key: (credential: C) => AccountKey;
  readonly label: (credential: C, addedAt: number) => string;
  readonly organization?: (credential: C) => string | undefined;
  readonly refresh?: (refreshToken: string, existing: C) => Effect.Effect<C, FlowFailure, NeedsWire>;
};

export const subscriptionAccounts = <C extends StoredCredential>(accounts: SubscriptionAccounts<C>): SubscriptionAccounts =>
  accounts as unknown as SubscriptionAccounts;
