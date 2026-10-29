import { Context, Data, type Effect } from 'effect';
import type { RefreshStage } from '@runlith/credential-file/RefreshFlight';
import type { GateRefusal, Unblock } from '../../../platform/contract/wire/refusal.js';
import type { SecretChangeRefusal, SecretReadRefusal, SecretRemoveRefusal, SecretRow, SecretSet } from '../wire/rows.js';

export class SecretsPlace extends Context.Service<SecretsPlace, { readonly home: string | null }>()('tagma/secrets/SecretsPlace') {}

export type SecretTarget = { readonly owner: string; readonly id: string; readonly name: string };

export type SecretEntry = { readonly name: string; readonly description: string };

export type SecretHolder = {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly entries: readonly SecretEntry[];
};

export type Handout = {
  readonly values: Readonly<Record<string, string>>;
  readonly redact: readonly string[];
  readonly signIn: unknown;
};

export type SignInRefresh<Grant, E, R> = {
  readonly grant: (signIn: unknown, stage: RefreshStage) => Effect.Effect<Grant, E>;
  readonly identity: (grant: Grant) => string;
  readonly needed: (grant: Grant) => Effect.Effect<boolean, E, R>;
  readonly refresh: (grant: Grant) => Effect.Effect<Grant, E, R>;
  readonly replace: (signIn: unknown, grant: Grant) => Effect.Effect<unknown, E>;
};

export type Handouts = (key: string) => Handout;

export class SecretOwnerFailed extends Data.TaggedError('SecretOwnerFailed')<{ readonly reason: string; readonly unblock: Unblock }> {
  override get message(): string {
    return this.reason;
  }
}

export class SecretStoreFailed extends Data.TaggedError('SecretStoreFailed')<{ readonly message: string }> {}

export type SecretOwner = {
  readonly kind: string;
  readonly holders: (projectId: number) => Effect.Effect<readonly SecretHolder[], SecretOwnerFailed>;
  readonly changed: (key: string) => Effect.Effect<void, SecretOwnerFailed>;
};

export class Secrets extends Context.Service<
  Secrets,
  {
    read(projectId: number, owner: string, id: string | undefined): Effect.Effect<readonly SecretSet[], GateRefusal<SecretReadRefusal>>;
    set(projectId: number, target: SecretTarget, value: string): Effect.Effect<SecretRow, GateRefusal<SecretChangeRefusal>>;
    remove(projectId: number, target: SecretTarget): Effect.Effect<SecretRow, GateRefusal<SecretRemoveRefusal>>;
  }
>()('tagma/secrets/Secrets') {}

export class SecretOwners extends Context.Service<
  SecretOwners,
  {
    register(owner: SecretOwner): Effect.Effect<() => void>;
    handout(kind: string): Effect.Effect<Handouts, SecretStoreFailed>;
    keepSignIn<E>(
      kind: string,
      key: string,
      change: (signIn: unknown) => Effect.Effect<unknown, E>,
    ): Effect.Effect<void, E | SecretStoreFailed>;
    refreshSignIn<Grant, E, R>(
      kind: string,
      key: string,
      request: SignInRefresh<Grant, E, R>,
    ): Effect.Effect<void, E | SecretStoreFailed, R>;
    drop(kind: string, key: string): Effect.Effect<void, SecretStoreFailed>;
    adopt(kind: string, values: Readonly<Record<string, Readonly<Record<string, string>>>>): Effect.Effect<void, SecretStoreFailed>;
    move(kind: string, into: string): Effect.Effect<void, SecretStoreFailed>;
  }
>()('tagma/secrets/SecretOwners') {}
