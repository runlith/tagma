import { Context, type Effect } from 'effect';
import type { HostRequestRef } from './protocol/execution';
import type { HostCustody, HostCustodyRevision } from './protocol/registration';
import type { AuthorityAnswer } from './protocol/wire';
import type { ExecutionsFailure } from './Executions';

export class HostAuthority extends Context.Service<
  HostAuthority,
  {
    readonly take: (operation: HostRequestRef, expected: HostCustodyRevision) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
    readonly fence: (operation: HostRequestRef, expected: HostCustodyRevision) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
    readonly release: (operation: HostRequestRef, custody: HostCustody) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
    readonly grant: (operation: HostRequestRef, share: number) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/HostAuthority') {}
