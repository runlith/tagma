import { Context, Data, type Effect } from 'effect';
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

export type Handout = { readonly values: Readonly<Record<string, string>>; readonly redact: readonly string[] };

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
    drop(kind: string, key: string): Effect.Effect<void, SecretStoreFailed>;
    adopt(kind: string, values: Readonly<Record<string, Readonly<Record<string, string>>>>): Effect.Effect<void, SecretStoreFailed>;
  }
>()('tagma/secrets/SecretOwners') {}
