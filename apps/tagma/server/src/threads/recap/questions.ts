import type { AgentAside, AgentAsideAnswer } from '@runlith/agent/AgentAside';
import { body } from '@runlith/activity/Activity';
import type { ActivityBody } from '@runlith/activity/fact';
import { Effect } from 'effect';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { ThreadAsks } from '../contract/service/asks.js';
import { ThreadLookup } from '../contract/service/reads.js';

export type RecapSelection = {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly account: string | null;
};

export type Unselected = 'gone' | 'running' | 'selection';

export type RecapQuestion = {
  readonly ask: Effect.Effect<AgentAsideAnswer, unknown>;
  readonly selected: Effect.Effect<RecapSelection | Unselected, unknown>;
};

export type Covered = {
  readonly journalHead: number;
  readonly position: number;
  readonly entryId: string;
  readonly run: string | null;
};

export const makeRecapQuestions = Effect.gen(function* () {
  const asks = yield* ThreadAsks;
  const threads = yield* ThreadLookup;

  const selection = Effect.fnUntraced(function* (threadId: string, copy: AgentAside) {
    const found = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
    if (found === undefined) return 'gone' satisfies Unselected;
    if (found.status === 'running') return 'running' satisfies Unselected;
    const standing = yield* asks.standing(copy, {
      provider: found.provider,
      model: found.model,
      reasoning: found.reasoning,
      account: found.account ?? null,
    });
    if (standing._tag === 'Moved') return 'selection' satisfies Unselected;
    const { provider, model, reasoning, account } = standing.basis;
    return { provider, model, reasoning, account } satisfies RecapSelection;
  });

  const posed = Effect.fnUntraced(function* (threadId: string, copy: AgentAside, instruction: string, covered: Covered) {
    yield* body(
      document('input', {
        instruction,
        covered: { ...covered, step: copy.stepNumber, readerInput: copy.readerInput, readerPosition: copy.readerPosition },
      }),
    );
    return {
      ask: Effect.map(asks.over(threadId, instruction, copy), (over) => over.answer),
      selected: selection(threadId, copy),
    } satisfies RecapQuestion;
  });

  return { selection, posed, held: asks.held };
});

const utf8 = new TextEncoder();

export function document(kind: string, value: object): ActivityBody {
  return { kind, contentType: 'application/json', encoded: utf8.encode(JSON.stringify(value)) };
}
