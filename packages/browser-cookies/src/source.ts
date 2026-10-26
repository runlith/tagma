import { Context, Data, type Effect } from 'effect';
import type { Reading } from './cookie.js';

export type SourceProfile = { readonly id: string; readonly name: string };

export type Unblock = readonly [string, ...string[]];

export class SourceUnreadable extends Data.TaggedError('SourceUnreadable')<{
  readonly message: string;
  readonly unblock: Unblock;
}> {}

export class ProfileMissing extends Data.TaggedError('ProfileMissing')<{ readonly message: string }> {}

export type KeyFailure = 'away' | 'denied' | 'missing' | 'failed';

export class KeyUnavailable extends Data.TaggedError('KeyUnavailable')<{ readonly reason: KeyFailure; readonly message: string }> {}

export type Access = 'keychain' | 'full-disk' | null;

export type CookieSource = {
  readonly id: string;
  readonly title: string;
  readonly access: Access;
  readonly profiles: Effect.Effect<readonly SourceProfile[], SourceUnreadable>;
  read(profile: string): Effect.Effect<Reading, SourceUnreadable | ProfileMissing | KeyUnavailable>;
};

export class SafeStorageKey extends Context.Service<
  SafeStorageKey,
  { read(service: string, account: string): Effect.Effect<string, KeyUnavailable> }
>()('@runlith/browser-cookies/SafeStorageKey') {}
