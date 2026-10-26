import { Clock, Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { ExternalSession, HarnessUnread } from '../../threads/contract/wire/harness/externalSession.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { HarnessTypedShape } from '../../threads/contract/wire/harness/externalSession.js';
import { userWords } from './entries.js';
import type { TerminalJournal } from './journal.js';
import type { ReportPlan } from '@runlith/agent/thread/run/lifecycle/RunReports';

export const unproven = (reason: string): HarnessFailure =>
  new GateRefusal('input-uncertain', reason, ['read the CLI hook, transcript or screen; do not resend this input']);

const carries = (entry: HarnessUnread, runId: string, items: readonly string[]): boolean =>
  entry.run === runId && entry.items.length === items.length && entry.items.every((id, at) => id === items[at]);

export const owedOf = (facet: ExternalSession, runId: string): readonly HarnessUnread[] =>
  (facet.unread ?? []).filter((entry) => entry.run === runId && entry.send !== undefined);

export const unsent = (entry: HarnessUnread): boolean => entry.send === 'intended' && entry.steered === true;

export const closedWords = (
  journal: TerminalJournal,
  threadId: string,
  facet: ExternalSession,
  runId: string,
): { readonly plans: readonly ReportPlan[]; readonly facet: ExternalSession } => {
  const standing = facet.unread ?? [];
  const back = standing.filter((entry) => entry.run === runId && unsent(entry));
  if (back.length === 0) return { plans: [], facet };
  const kept = standing.filter((entry) => !back.includes(entry));
  const { unread: _settled, ...rest } = facet;
  return { plans: returnedWords(journal, threadId, back), facet: kept.length === 0 ? rest : { ...rest, unread: kept } };
};

export const returnedWords = (journal: TerminalJournal, threadId: string, entries: readonly HarnessUnread[]): readonly ReportPlan[] =>
  entries.filter(unsent).map((entry) => journal.reports.fate({ id: entry.run, threadId }, 'returned', entry.items));

export const stoppedWords = (
  journal: TerminalJournal,
  threadId: string,
  entries: readonly HarnessUnread[],
  said: boolean,
): readonly ReportPlan[] =>
  entries.map((entry) => {
    const run = { id: entry.run, threadId };
    if (unsent(entry)) return journal.reports.fate(run, 'returned', entry.items);
    if (entry.send === 'intended') return journal.reports.fate(run, 'read', entry.items, said ? true : undefined);
    return journal.reports.fate(run, 'unconfirmed', entry.items);
  });

export class TerminalWords {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly journal: TerminalJournal,
  ) {}

  intend(
    threadId: string,
    runId: string,
    items: readonly string[],
    spoken: string,
    digest: string | undefined,
  ): Effect.Effect<void, HarnessFailure> {
    const at = new Date().toISOString();
    return this.store.change(threadId, (facet) =>
      Effect.succeed({
        facet: {
          ...facet,
          turn: { run: runId, turn: null, openedAt: at, offset: null, words: spoken === '' ? undefined : spoken },
          unread:
            items.length === 0 ? facet.unread : [...(facet.unread ?? []), { run: runId, items, at, send: 'intended' as const, digest }],
        },
        value: undefined,
      }),
    );
  }

  steered(threadId: string, runId: string, items: readonly string[], digest: string | undefined): Effect.Effect<boolean, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      this.store.change(threadId, (facet) => {
        if (facet.turn?.run !== runId) return Effect.succeed({ facet, value: false });
        const entry = { run: runId, items, at: new Date(now).toISOString(), send: 'intended' as const, digest, steered: true as const };
        return Effect.succeed({ facet: { ...facet, unread: [...(facet.unread ?? []), entry] }, value: true });
      }),
    );
  }

  sending(
    threadId: string,
    runId: string,
    items: readonly string[],
    typed: HarnessTypedShape | undefined,
  ): Effect.Effect<boolean, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      this.store.change(threadId, (facet) => {
        const entries = facet.unread ?? [];
        const owed = entries.find((entry) => entry.send !== undefined && carries(entry, runId, items));
        if (owed === undefined) return Effect.succeed({ facet, value: false });
        if (owed.send === 'sending') return Effect.succeed({ facet, value: true });
        const at = new Date(now).toISOString();
        const turn = facet.turn;
        return Effect.succeed({
          facet: {
            ...facet,
            ...(turn?.run === runId && typed !== undefined ? { turn: { ...turn, typed: [...(turn.typed ?? []), typed] } } : {}),
            unread: entries.map((entry) => (entry === owed ? { ...entry, at, send: 'sending' as const } : entry)),
          },
          value: true,
        });
      }),
    );
  }

  retract(threadId: string, runId: string): Effect.Effect<void, HarnessFailure> {
    return this.store.change(threadId, (facet) => {
      const { turn, unread, ...rest } = facet;
      const kept = (unread ?? []).filter((entry) => entry.run !== runId);
      if (turn?.run !== runId && kept.length === (unread ?? []).length) return Effect.succeed({ facet, value: undefined });
      return Effect.succeed({
        facet: {
          ...rest,
          turn: turn !== undefined && turn.run !== runId ? turn : undefined,
          unread: kept.length === 0 ? undefined : kept,
        },
        value: undefined,
      });
    });
  }

  accepted(threadId: string, uncertain: HarnessFailure | null, items?: readonly string[]): Effect.Effect<void, HarnessFailure> {
    const { journal } = this;
    return this.store.change(
      threadId,
      (facet, unit) =>
        Effect.gen(function* () {
          const turn = facet.turn;
          const typed = (entry: HarnessUnread): boolean =>
            items === undefined ? entry.send === 'sending' : entry.send !== undefined && carries(entry, entry.run, items);
          const pending = (facet.unread ?? []).find(typed);
          const runId = pending?.run ?? turn?.run;
          if (runId === undefined) return { facet, value: undefined };
          const run = { id: runId, threadId };
          const resolves = (entry: HarnessUnread): boolean =>
            items === undefined ? typed(entry) && entry.run === runId : entry === pending;
          let next = facet;
          if (uncertain !== null) {
            const owed = (facet.unread ?? []).filter(resolves).flatMap((entry) => entry.items);
            if (owed.length > 0) yield* journal.apply(unit, [journal.reports.fate(run, 'unconfirmed', owed)]);
          } else if (turn !== undefined && turn.run === runId && turn.words !== undefined) {
            yield* journal.apply(unit, [journal.reports.recorded(run, [userWords(turn.run, turn.words)], `words:${turn.run}`)]);
            const { words: _written, ...rest } = turn;
            next = { ...next, turn: rest };
          }
          if (pending !== undefined) {
            next = {
              ...next,
              unread: (next.unread ?? []).map((entry) => {
                if (!resolves(entry)) return entry;
                const { send: _resolved, ...settled } = entry;
                return settled;
              }),
            };
          }
          return { facet: next, value: undefined };
        }),
      journal.writes,
    );
  }
}
