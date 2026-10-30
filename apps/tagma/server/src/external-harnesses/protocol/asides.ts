import { Effect, Exit } from 'effect';
import type { AgentAsideQuestion } from '@runlith/agent/AgentAside';
import type { ThreadAggregateStorage } from '@runlith/agent/thread/storage/aggregate';
import { userMessageEntryId } from '@runlith/agent/transcript/entryNames';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { SessionAside, SessionCapture, SessionCopies } from '../contract/service/copies.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import { harnessServed } from '../sessions/model.js';
import { ASIDE } from '@runlith/hosted-runner/wire/extensions';
import { LinkEnded, type Link, type ProtocolLinks } from './links.js';
import { asideLost } from './methods/aside.js';
import type { Answers } from './methods/answers.js';
import type { AsideOutcome } from './methods/declaration.js';
import type { Closed, ProtocolSteps } from './steps.js';

const CLOSED = 'The agent session closed before it answered the aside.';

export class ProtocolAsides {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly steps: ProtocolSteps,
    private readonly answers: Answers<AsideOutcome>,
    private readonly inbox: ThreadInbox['Service'],
    private readonly threads: ThreadAggregateStorage<Unit<'machine'>, WriteUnit<'machine'>>,
    private readonly copies: SessionCopies['Service'],
  ) {}

  of(link: Link): SessionAside | undefined {
    const served = harnessServed(link.adapter, link.facet, link.asked);
    if (served === null || !this.offered(link)) return undefined;
    const threadId = link.threadId;
    return { served, ask: (question) => this.ask(threadId, question) };
  }

  exited(threadId: string): Effect.Effect<void> {
    return this.copies.exited(threadId);
  }

  readonly measured = Effect.fnUntraced(function* (this: ProtocolAsides, link: Link) {
    const turn = link.row.turns.at(-1)?.id;
    if (turn === undefined) return;
    const input = yield* this.capture(link, turn);
    if (input !== null) yield* this.copies.measured(input);
  });

  readonly kept = Effect.fnUntraced(function* (this: ProtocolAsides, link: Link, closing: Closed) {
    if (closing.status !== 'applied') return;
    const input = yield* this.capture(link, closing.ending.turn);
    if (input !== null) yield* this.copies.settled(input);
  });

  private readonly capture = Effect.fnUntraced(function* (this: ProtocolAsides, link: Link, turn: string) {
    const aside = this.of(link);
    if (aside === undefined) return null;
    const reader = (yield* this.inbox.readerSpoke(link.threadId, turn)) ? userMessageEntryId(turn) : null;
    const reading = (yield* this.threads.metadata(link.threadId))?.contextReading ?? null;
    return { threadId: link.threadId, turn, aside, readerInput: reader, reading } satisfies SessionCapture;
  });

  readonly ask = Effect.fnUntraced(function* (this: ProtocolAsides, threadId: string, question: AgentAsideQuestion) {
    const { links, answers } = this;
    const link = links.get(threadId);
    const key = link?.facet.sessionKey ?? null;
    if (link === undefined || key === null || link.row.phase !== 'ready' || !this.offered(link)) {
      return yield* asideLost('The agent session that would answer this aside is not open.');
    }
    const issued: { request: string | null } = { request: null };
    return yield* this.exchange(threadId, link, key, question, issued).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (issued.request !== null) answers.forget(issued.request);
        }),
      ),
    );
  });

  private readonly exchange = Effect.fnUntraced(function* (
    this: ProtocolAsides,
    threadId: string,
    link: Link,
    key: string,
    question: AgentAsideQuestion,
    issued: { request: string | null },
  ) {
    const { links, steps, answers } = this;
    yield* links
      .locked(
        link,
        Effect.map(
          steps.intend(link, {
            _tag: 'Extend',
            method: ASIDE,
            envelopes: [],
            params: { sessionId: key, question: question.instruction },
          }),
          (done) => {
            issued.request = done.request;
            if (issued.request !== null) answers.expect(issued.request);
          },
        ),
      )
      .pipe(Effect.mapError((failure) => asideLost(failure.message)));
    const asked = issued.request;
    if (asked === null) return yield* asideLost(CLOSED);
    const outcome = yield* links
      .until(threadId, (current) => (current === link ? answers.outcome(asked) : Exit.fail(asideLost(CLOSED))))
      .pipe(Effect.mapError((failure) => asideLost(failure instanceof LinkEnded ? CLOSED : failure.message)));
    return yield* outcome;
  });

  private offered(link: Link): boolean {
    return link.row.client.extensions.includes(ASIDE);
  }
}
