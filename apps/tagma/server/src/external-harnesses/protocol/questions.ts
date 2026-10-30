import { Clock, type Deferred, Effect } from 'effect';
import type { ClientEvent } from '@runlith/acp/events';
import type { AgentRequest } from '@runlith/acp/state';
import type { AskDelivery } from '@runlith/agent/thread/transport/contract';
import type { ThreadQuestionEntry } from '@runlith/agent/transcript/entries';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { HarnessJudging } from '../contract/service/permissions.js';
import { allowOnce, chosenOption, judgedCall, questionEntry, questionId, refusal, type PermissionAsk } from './asks.js';
import type { ProtocolJournal } from './journal.js';
import type { AskLandings } from './landings.js';
import type { Link } from './links.js';
import type { OpenedTurn } from './row.js';
import type { Closed, Persisted, ProtocolSteps } from './steps.js';

const NOT_FOUND = -32601;

const AGENT_CHOICE = { ruleId: 'agent-choice', action: 'cli-question', asked: ['cli-question'], parent: true };

export type Delivered = { readonly landing: Deferred.Deferred<AskDelivery> | null; readonly persisted: Persisted | null };

export class ProtocolAsks {
  constructor(
    private readonly steps: ProtocolSteps,
    private readonly permissions: HarnessJudging,
    private readonly journal: ProtocolJournal,
    private readonly landings: AskLandings,
    private readonly routed: (threadId: string) => Effect.Effect<void, HarnessFailure>,
  ) {}

  readonly asked = Effect.fnUntraced(function* (this: ProtocolAsks, link: Link, ask: AgentRequest) {
    const { steps, permissions, journal } = this;
    if (ask.kind === 'other') {
      return yield* steps.answer(link, ask.id, {
        _tag: 'Error',
        error: { code: NOT_FOUND, message: `Tagma answers no ${ask.method}.` },
      });
    }
    const known = link.row.client.turn?.calls[ask.params.toolCall.toolCallId];
    const judged = judgedCall(ask, known, link.profile.otherMutates, link.adapter.tools);
    const verdict = yield* permissions.verdict(link.threadId, judged.call, judged.mutating);
    if (verdict._tag === 'Denies') {
      const refused = refusal(ask);
      return yield* steps.answer(link, ask.id, {
        _tag: 'Permission',
        outcome: refused === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: refused },
      });
    }
    const allowed = allowOnce(ask);
    if (verdict._tag === 'Unspoken' && allowed !== null) {
      return yield* steps.answer(link, ask.id, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: allowed } });
    }
    const run = ask.turn ?? link.row.turns.at(-1)?.id ?? null;
    if (run === null) return yield* steps.answer(link, ask.id, { _tag: 'Permission', outcome: { outcome: 'cancelled' } });
    const entry = questionEntry(
      ask,
      run,
      permissions.prompt(link.adapter, judged.call),
      verdict._tag === 'Asks' ? verdict.reason : null,
      verdict._tag === 'Asks' ? { ruleId: verdict.ruleId, action: judged.call.tool, asked: verdict.asked } : AGENT_CHOICE,
      new Date(yield* Clock.currentTimeMillis).toISOString(),
    );
    const persisted = yield* steps.persist(link, {
      row: (row) => ({ ...row, asked: [...row.asked, ask.id] }),
      reports: [journal.asked({ id: run, threadId: link.threadId }, entry, `ask:${String(ask.id)}`)],
    });
    if (persisted !== null) yield* this.routed(link.threadId);
    return persisted;
  });

  readonly held = Effect.fnUntraced(function* (this: ProtocolAsks, link: Link) {
    const events: ClientEvent[] = [];
    const begun: string[] = [];
    const ended: OpenedTurn[] = [];
    const endings: Closed[] = [];
    for (const ask of link.row.client.asks) {
      if (ask.answer !== null || ask.uncertain) continue;
      const restored = link.row.asked.includes(ask.id) ? yield* this.recovered(link, ask) : yield* this.asked(link, ask);
      if (restored !== null) {
        events.push(...restored.events);
        begun.push(...restored.begun);
        ended.push(...restored.ended);
        endings.push(...restored.endings);
      }
    }
    const held: Persisted = { events, begun, ended, endings };
    return held;
  });

  private readonly recovered = Effect.fnUntraced(function* (this: ProtocolAsks, link: Link, ask: AgentRequest) {
    const { journal, steps } = this;
    if (ask.kind !== 'permission' || ask.turn === null) return null;
    const saved = (yield* journal.questions(link.threadId, ask.turn)).findLast(
      (entry) =>
        entry.questionId === questionId(ask.id) && entry.status === 'open' && entry.answers !== undefined && entry.deliveryUnknown !== true,
    );
    const value = saved?.answers?.[0]?.values[0];
    const chosen = value === undefined ? null : chosenOption(ask, value);
    if (chosen === null) return null;
    return yield* steps.answer(link, ask.id, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: chosen } });
  });

  readonly delivered = Effect.fnUntraced(function* (this: ProtocolAsks, link: Link, question: ThreadQuestionEntry, value: string) {
    const { landings, steps } = this;
    const ask = link.row.client.asks.find(
      (standing): standing is PermissionAsk =>
        standing.kind === 'permission' &&
        questionId(standing.id) === question.questionId &&
        standing.answer === null &&
        !standing.uncertain,
    );
    if (ask === undefined) return { landing: null, persisted: null } as Delivered;
    const chosen = chosenOption(ask, value);
    if (chosen === null) {
      return yield* new GateRefusal('answer-invalid', `This ask does not offer ${value}.`, ['answer with a value this ask offers']);
    }
    const landing = landings.expect(link.threadId, ask.id);
    const persisted = yield* steps.answer(link, ask.id, { _tag: 'Permission', outcome: { outcome: 'selected', optionId: chosen } });
    if (persisted === null) {
      landings.forget(link.threadId, ask.id);
      return { landing: null, persisted: null } as Delivered;
    }
    const delivered: Delivered = { landing, persisted };
    return delivered;
  });
}
