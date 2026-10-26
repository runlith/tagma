import { Deferred, Effect } from 'effect';
import type { AskDelivery } from '@runlith/agent/thread/transport/contract';
import type { ThreadInteractionAnswer, ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ProtocolAttendance } from './attendance.js';
import { LinkEnded, WaitExpired, type ProtocolLinks } from './links.js';
import type { ProtocolAsks } from './questions.js';
import type { ProtocolReactor } from './reactor.js';

const ANSWER_WAIT = '10 seconds';
const LANDING_WAIT = '60 seconds';

export class ProtocolInputs {
  constructor(
    private readonly links: ProtocolLinks,
    private readonly attendance: ProtocolAttendance,
    private readonly reactor: ProtocolReactor,
    private readonly asks: ProtocolAsks,
  ) {}

  readonly answer = Effect.fnUntraced(function* (
    this: ProtocolInputs,
    threadId: string,
    question: ThreadQuestionEntry,
    answers: readonly ThreadInteractionAnswer[],
  ) {
    const { attendance, links, reactor, asks } = this;
    const value = answers.length === 1 && answers[0]?.values.length === 1 ? answers[0].values[0] : undefined;
    if (value === undefined) {
      return yield* new GateRefusal('answer-invalid', 'Choose exactly one offered value.', [
        'answer the standing ask with one offered value',
      ]);
    }
    yield* attendance.attend(threadId);
    const link = yield* links
      .until(threadId, (standing) => standing ?? null, { within: ANSWER_WAIT })
      .pipe(
        Effect.mapError((failure) =>
          failure instanceof LinkEnded
            ? failure.refusal
            : failure instanceof WaitExpired
              ? new GateRefusal('session-uncertain', 'The agent session has not come back.', ['read the thread state'])
              : failure,
        ),
      );
    const decided: { landing: Deferred.Deferred<AskDelivery> | null } = { landing: null };
    yield* reactor.locked(
      link,
      Effect.map(asks.delivered(link, question, value), (done) => {
        decided.landing = done.landing;
        return done.persisted;
      }),
    );
    if (decided.landing === null) return 'gone' as AskDelivery;
    const landed = yield* Effect.timeoutOption(Deferred.await(decided.landing), LANDING_WAIT);
    if (landed._tag === 'None') {
      return yield* new GateRefusal('session-uncertain', 'The agent has not taken the answer yet.', ['read the thread state']);
    }
    return landed.value;
  });
}
