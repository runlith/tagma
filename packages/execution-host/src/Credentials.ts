import { Data, Context, type Effect } from 'effect';
import type { CredentialReferences, Role } from '@runlith/executions/protocol/registration';

export class CredentialRefused extends Data.TaggedError('CredentialRefused')<{ readonly role: Role }> {
  override get message(): string {
    return `the ${this.role} credential was refused`;
  }
}

export class CredentialsFailed extends Data.TaggedError('CredentialsFailed')<{
  readonly path: string;
  readonly act: string;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export class Credentials extends Context.Service<
  Credentials,
  {
    readonly references: CredentialReferences;
    readonly authenticate: (role: Role, secret: string) => Effect.Effect<Role, CredentialRefused | CredentialsFailed>;
  }
>()('@runlith/execution-host/Credentials') {}
