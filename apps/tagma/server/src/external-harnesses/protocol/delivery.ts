import { Effect } from 'effect';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import { WithdrawFailed, type Withdrawal } from '@runlith/agent/thread/transport/contract';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import { STEER } from '../contract/wire/extensions.js';
import type { ProtocolLaunches } from './launches.js';
import { LinkEnded, WaitExpired, type ProtocolLinks } from './links.js';
import type { Answers } from './methods/answers.js';
import type { WithdrawOutcome } from './methods/declaration.js';
import type { ProtocolPrompts } from './prompts.js';
import type { ProtocolReactor } from './reactor.js';

const WITHDRAW_WAIT = '10 seconds';

const reasonOf = (failure: unknown): string =>
  failure instanceof GateRefusal ? failure.reason : failure instanceof Error ? failure.message : String(failure);

export class ProtocolDelivery {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly reactor: ProtocolReactor,
    private readonly prompts: ProtocolPrompts,
    private readonly launches: ProtocolLaunches,
    private readonly withdrawals: Answers<WithdrawOutcome>,
    private readonly inbox: ThreadInbox['Service'],
  ) {}

  handed(runId: string, threadId: string): Effect.Effect<readonly ThreadInboxItem[], HarnessFailure> {
    return Effect.suspend(() => {
      const written = new Set(
        (this.links.get(threadId)?.row.client.requests ?? []).flatMap((request) =>
          request.meaning === 'extension' && request.method === STEER && request.admitted ? request.envelopes : [],
        ),
      );
      return written.size === 0
        ? Effect.succeed([])
        : Effect.map(this.inbox.inputHanded(threadId, runId), (items) => items.filter((item) => written.has(item.id)));
    });
  }

  pump(threadId: string): Effect.Effect<void, HarnessFailure> {
    return Effect.suspend(() => {
      const link = this.links.get(threadId);
      return link === undefined ? Effect.void : this.reactor.pump(link);
    });
  }

  queued(runId: string, threadId: string): Effect.Effect<void, HarnessFailure> {
    return Effect.suspend(() => {
      const link = this.links.get(threadId);
      return link === undefined ? Effect.void : this.reactor.locked(link, this.prompts.delivered(link, runId));
    });
  }

  deliver(runId: string, threadId: string, ids: readonly string[]): Effect.Effect<void, HarnessFailure> {
    return Effect.suspend(() => {
      this.launches.hand(runId, ids);
      return this.queued(runId, threadId);
    });
  }

  readonly withdraw = Effect.fnUntraced(function* (this: ProtocolDelivery, threadId: string, inputId: string) {
    const { links, reactor, prompts, withdrawals } = this;
    const link = links.get(threadId);
    if (link === undefined) return 'unsent' as Withdrawal;
    const asked: { request: string | null } = { request: null };
    yield* reactor
      .locked(
        link,
        Effect.map(prompts.withdraw(link, inputId), (issued) => {
          asked.request = issued?.request ?? null;
          if (asked.request !== null) withdrawals.expect(asked.request);
          return issued;
        }),
      )
      .pipe(Effect.mapError((failure) => new WithdrawFailed({ reason: reasonOf(failure) })));
    const request = asked.request;
    if (request === null) return 'unsent' as Withdrawal;
    const outcome = yield* links
      .until(threadId, (standing) => (standing === link ? withdrawals.outcome(request) : null), { within: WITHDRAW_WAIT })
      .pipe(
        Effect.mapError((failure) =>
          failure instanceof LinkEnded
            ? new WithdrawFailed({ reason: failure.refusal.reason })
            : failure instanceof WaitExpired
              ? new WithdrawFailed({ reason: 'it has not answered' })
              : new WithdrawFailed({ reason: reasonOf(failure) }),
        ),
        Effect.ensuring(Effect.sync(() => withdrawals.forget(request))),
      );
    const withdrawn = yield* Effect.mapError(outcome, (failure) => new WithdrawFailed({ reason: failure.reason }));
    return (withdrawn ? 'withdrawn' : 'taken') as Withdrawal;
  });
}
