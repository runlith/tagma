import { Effect, Schedule } from 'effect';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import type { TerminalRequests, Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalOperationKey } from '../../executions/contract/wire/requestKeys.js';
import { principalOf } from '../../executions/terminals/principals.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import { facetOf, type Link, type ProtocolLinks } from './links.js';
import { hostUnavailable } from './link.js';

export class ProtocolHalts {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly store: HarnessSessionStore,
    private readonly terminals: Terminals['Service'],
    private readonly requests: TerminalRequests['Service'],
  ) {}

  readonly end = Effect.fn('ProtocolDriver.halt')(function* (
    this: ProtocolHalts,
    threadId: string,
    facet: ExternalSession,
    operation?: string,
  ) {
    const { terminals, requests } = this;
    yield* Effect.annotateCurrentSpan('threadId', threadId);
    if (facet.execution === null || facet.session === undefined) return;
    const record = yield* terminals.record(facet.execution.execution, facet.execution.incarnation).pipe(Effect.mapError(threadCallFailed));
    if (record === null) return;
    const base = `harness-stop:${operation ?? facet.session.id}:${facet.execution.execution}:${facet.execution.incarnation}`;
    let ordinal = 0;
    const ending = Effect.fnUntraced(function* () {
      const operationId = HostRequestKey.make(ordinal === 0 ? base : `${base}:${ordinal}`);
      if ((yield* terminals.lost(record)) !== null) return true;
      const standing = yield* terminals.state(record.execution);
      if (standing === undefined || standing.state.phase === 'ended') return true;
      const taken = yield* requests.request(record.projectId, operationId);
      if (taken._tag === 'Unknown') {
        const key: TerminalOperationKey = {
          projectId: record.projectId,
          operationId,
          requester: principalOf({ _tag: 'Operator' }),
          mutation: 'stop',
          targetKey: record.targetKey,
          execution: record.execution,
        };
        yield* terminals.stop(record.projectId, key, record.execution, record.revision, 'explicit-stop', 'signal');
        return true;
      }
      if (taken._tag === 'Settled') {
        if (taken.stop !== undefined) return true;
        ordinal += 1;
        return false;
      }
      if (taken._tag === 'Expired')
        return yield* new GateRefusal('session-uncertain', 'The old agent stop receipt expired while its process still runs.', [
          'stop this session’s execution as a new act, then restart the agent',
        ]);
      return false;
    });
    yield* ending().pipe(
      Effect.retry({
        schedule: Schedule.spaced(250),
        while: (failure) => hostUnavailable(failure) || (failure._tag === 'TerminalRefused' && failure.reason === 'operation-conflict'),
      }),
      Effect.repeat({ schedule: Schedule.spaced(250), while: (done) => !done }),
      Effect.mapError(threadCallFailed),
    );
  });

  readonly failed = Effect.fnUntraced(function* (this: ProtocolHalts, link: Link, refusal: GateRefusal) {
    link.refusal = refusal;
    this.links.raise(link.threadId);
    yield* this.end(link.threadId, yield* facetOf(this.store, link.threadId));
  });

  readonly settled = Effect.fnUntraced(function* (this: ProtocolHalts, link: Link) {
    if ((link.row.failure === null && link.poisoned === null && link.refused === null) || link.halted) return;
    if (link.poisoned !== null && link.refused === null) link.refused = link.poisoned;
    link.facet = yield* facetOf(this.store, link.threadId);
    yield* this.end(link.threadId, link.facet);
    link.halted = true;
  });
}
