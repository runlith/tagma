import { Effect } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalOperationKey } from '../../executions/contract/wire/requestKeys.js';
import { principalOf } from '../../executions/terminals/principals.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { facetOf, type Link, type ProtocolLinks } from './links.js';

export const halt = Effect.fn('ProtocolDriver.halt')(function* (terminals: Terminals['Service'], threadId: string, facet: ExternalSession) {
  yield* Effect.annotateCurrentSpan('threadId', threadId);
  if (facet.execution === null || facet.session === undefined) return;
  const record = yield* terminals.record(facet.execution.execution, facet.execution.incarnation).pipe(Effect.mapError(threadCallFailed));
  if (record === null) return;
  const key: TerminalOperationKey = {
    projectId: record.projectId,
    operationId: HostRequestKey.make(`harness-stop:${facet.session.id}:${facet.execution.execution}:${facet.execution.incarnation}`),
    requester: principalOf({ _tag: 'Operator' }),
    mutation: 'stop',
    targetKey: record.targetKey,
    execution: record.execution,
  };
  yield* terminals.stop(record.projectId, key, record.execution, record.revision, 'explicit-stop', 'signal').pipe(
    Effect.catchTag('TerminalRefused', (refusal) => (refusal.reason === 'operation-conflict' ? Effect.void : Effect.fail(refusal))),
    Effect.mapError(threadCallFailed),
  );
});

export class ProtocolHalts {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly store: HarnessSessionStore,
    private readonly terminals: Terminals['Service'],
  ) {}

  readonly failed = Effect.fnUntraced(function* (this: ProtocolHalts, link: Link, refusal: GateRefusal) {
    link.refusal = refusal;
    this.links.raise(link.threadId);
    yield* halt(this.terminals, link.threadId, yield* facetOf(this.store, link.threadId));
  });

  readonly settled = Effect.fnUntraced(function* (this: ProtocolHalts, link: Link) {
    if ((link.row.failure === null && link.poisoned === null && link.refused === null) || link.halted) return;
    link.halted = true;
    if (link.poisoned !== null && link.refused === null) link.refused = link.poisoned;
    link.facet = yield* facetOf(this.store, link.threadId);
    yield* halt(this.terminals, link.threadId, link.facet);
  });
}
