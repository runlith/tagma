import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProfileId } from '../wire/ids.js';
import type { ConsoleCapture, Profile } from '../wire/profile.js';
import type { ProfileRecord } from './hosts.js';

export type ProfileDraft = {
  readonly name: string;
  readonly adapter: string;
  readonly document: unknown;
  readonly console: ConsoleCapture | undefined;
};

export type ProfileChange = { readonly name: string | undefined; readonly console: ConsoleCapture | undefined };

export class Profiles extends Context.Service<
  Profiles,
  {
    readonly list: Effect.Effect<readonly Profile[], StoreFailure>;
    record(id: ProfileId): Effect.Effect<ProfileRecord, StoreFailure | GateRefusal<'profile-unknown'>>;
    chosen(projectId: number, human: boolean): Effect.Effect<ProfileId, StoreFailure>;
    create(draft: ProfileDraft): Effect.Effect<Profile, StoreFailure | GateRefusal<'adapter-unknown' | 'document-invalid'>>;
    update(id: ProfileId, change: ProfileChange): Effect.Effect<Profile, StoreFailure | GateRefusal<'profile-unknown'>>;
    remove(id: ProfileId): Effect.Effect<boolean, StoreFailure | GateRefusal<'profile-unknown'>>;
    clear(id: ProfileId): Effect.Effect<boolean, StoreFailure | GateRefusal<'profile-unknown'>>;
    readonly connected: Effect.Effect<readonly ProfileId[], StoreFailure>;
    exclusive<A, E, R>(id: ProfileId, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
    readonly changes: Effect.Effect<Stream.Stream<ProfileId>, never, Scope.Scope>;
  }
>()('tagma/browser/Profiles') {}
