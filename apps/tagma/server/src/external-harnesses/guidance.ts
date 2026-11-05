import { Effect } from 'effect';
import type { ThreadEventBody } from '@runlith/agent/thread/events';
import type { GuidanceSources } from '@runlith/agent/thread/transport/contract';
import type { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { touchText } from '../graph/orientation/touches.js';
import { includeInstructions } from '../graph/orientation/tagPrompts.js';
import type { TouchBrief } from '../graph/contract/service/orientation.js';
import type { HarnessFailure } from '../threads/contract/service/failure.js';
import type { ClearedGuidance, Guided, HarnessGuidance, RunGuiding, RunHosting } from './contract/service/guidance.js';
import type { SessionIdentity } from '../platform/contract/wire/session.js';
import type { HarnessSessionStore } from './store/sessions.js';
import type { TerminalJournal } from './terminal/journal.js';
import type { WorkPlaces } from '../threads/contract/service/working.js';
import type { ThreadRecords } from '../thread-record/contract/service/records.js';
import type { InstructionSet } from '../graph/contract/wire/instructions.js';
import type { Place } from '../platform/contract/wire/place.js';
import { Context } from 'effect';
import { Orientation } from '../graph/contract/service/orientation.js';
import { deliveredLaw, instructionDelivery } from './instructions.js';
import { threadCallFailed } from '../threads/contract/service/failure.js';
import type { RunReports, AdapterReports } from '@runlith/agent/thread/run/lifecycle/RunReports';
import { hostedHistory, hostedTurns } from './hostedHistory.js';
import { seededHistory, turnText } from '@runlith/hosted-runner/wire/historyText';

export const makeHookGuidance = (
  guidance: RunGuiding,
  sources: GuidanceSources,
  store: HarnessSessionStore,
  journal: TerminalJournal,
  working: WorkPlaces['Service'],
  records: ThreadRecords['Service'],
  reportsFor: RunReports['Service'],
  hosting: RunHosting,
  identity: SessionIdentity['Service'],
): HarnessGuidance['Service'] => {
  const runOf = (threadId: string): Effect.Effect<string, HarnessFailure> =>
    Effect.map(store.read(threadId), (facet) => facet?.turn?.run ?? threadId);

  const reportsOf = Effect.fnUntraced(function* (threadId: string) {
    const projectId = yield* records.projectOf(threadId).pipe(Effect.mapError(threadCallFailed));
    if (projectId === undefined) return yield* threadCallFailed(new Error(`Thread ${threadId} has no home.`));
    const binding = yield* store.binding(threadId).pipe(Effect.mapError(threadCallFailed));
    if (binding === undefined) return yield* threadCallFailed(new Error(`Thread ${threadId} is gone.`));
    const reports: AdapterReports = reportsFor.of(binding.transport.adapter);
    return reports;
  });

  const record = (threadId: string, events: readonly ThreadEventBody[], evidence: string): Effect.Effect<void, HarnessFailure> =>
    Effect.flatMap(reportsOf(threadId), (reports) =>
      store.change(
        threadId,
        (standing, unit) =>
          Effect.map(
            Effect.mapError(journal.apply(unit, [reports.outside(threadId, events, evidence)]), (cause): HarnessFailure => cause),
            () => ({ facet: standing, value: undefined }),
          ),
        journal.writes,
      ),
    );

  const tell = Effect.fnUntraced(function* (
    threadId: string,
    evidence: string,
    decide: Parameters<RunGuiding['hook']>[3],
    options?: { readonly law?: (delivered: unknown) => Effect.Effect<ReturnType<typeof instructionDelivery>, ThreadCallBroke> },
  ) {
    const runId = yield* runOf(threadId);
    return yield* Effect.mapError(
      guidance.hook(threadId, runId, evidence, decide, (events) => record(threadId, events, `guidance:${evidence}`), options),
      (cause): HarnessFailure => cause,
    );
  });

  const prompt = Effect.fnUntraced(function* (threadId: string, evidence: string, inputs: readonly string[]) {
    const replayed = yield* tell(threadId, evidence, () => null);
    if (replayed !== null) {
      const again: Guided = { text: replayed };
      return again;
    }
    const projectId = yield* records.projectOf(threadId).pipe(Effect.mapError(threadCallFailed));
    if (projectId === undefined) return yield* threadCallFailed(new Error(`Thread ${threadId} has no home.`));
    const runId = yield* runOf(threadId);
    const notes = yield* Effect.mapError(guidance.notes(threadId, runId, { projectId, inputs }, sources), (cause): HarnessFailure => cause);
    const said = yield* tell(threadId, evidence, () => notes?.text ?? null);
    const guided: Guided = { text: said };
    return guided;
  });

  const touch = Effect.fnUntraced(function* (threadId: string, evidence: string, briefs: readonly TouchBrief[], places: readonly Place[]) {
    const home = yield* records.projectOf(threadId).pipe(Effect.mapError(threadCallFailed));
    if (home === undefined) return yield* threadCallFailed(new Error(`Thread ${threadId} has no home.`));
    for (const place of places) {
      if (place.checkout === null) return yield* threadCallFailed(new Error('A touch place needs its checkout.'));
      yield* working
        .enter({ threadId, home, place: { projectId: place.projectId, root: place.checkout }, mutates: false })
        .pipe(Effect.mapError(threadCallFailed));
    }
    let instructions: readonly InstructionSet[] = [];
    const said = yield* tell(
      threadId,
      evidence,
      (ledger) => {
        for (const set of instructions) includeInstructions(ledger.delivered, set);
        const lines = briefs.flatMap((brief) => {
          const line = touchText(brief, ledger, identity, {});
          return line === null ? [] : [line];
        });
        return lines.length === 0 ? null : lines.join('\n\n');
      },
      {
        law: Effect.fnUntraced(function* (delivered: unknown) {
          const known = yield* deliveredLaw(delivered);
          const diffs = yield* Effect.forEach(places, (place) =>
            Effect.gen(function* () {
              if (place.checkout === null) return yield* threadCallFailed(new Error('A touch place needs its checkout.'));
              const served = yield* working.graphAt({ projectId: place.projectId, root: place.checkout });
              return yield* Context.get(served.context, Orientation)
                .changes({ projectId: place.projectId, audience: 'graph', previous: known[String(place.projectId)] })
                .pipe(Effect.provide(served.context));
            }),
          ).pipe(Effect.mapError(threadCallFailed));
          instructions = diffs.map((diff) => diff.set);
          return instructionDelivery(known, diffs, threadId);
        }),
      },
    );
    const guided: Guided = { text: said };
    return guided;
  });

  const cleared = Effect.fnUntraced(function* (threadId: string, evidence: string) {
    const runId = yield* runOf(threadId);
    const reset = yield* Effect.mapError(guidance.cleared(threadId, runId, false), (cause): HarnessFailure => cause);
    const reports = yield* reportsOf(threadId);
    const result: ClearedGuidance = {
      plan: reports.outside(threadId, reset.events, `guidance-reset:${evidence}`),
      delivered: reset.delivered,
    };
    return result;
  });

  const seed = Effect.fnUntraced(function* (threadId: string, room: number) {
    const none: Guided = { text: null };
    const session = (yield* store.read(threadId))?.session;
    if (session?.seed !== true) return none;
    const turns = hostedTurns(yield* Effect.mapError(hosting.history(threadId, 'referenced'), threadCallFailed));
    const text = seededHistory(turns.length, (at) => turnText(hostedHistory(turns[at]!)), room);
    const sown = yield* store.change(threadId, (standing) => {
      const held = standing.session;
      if (held?.id !== session.id || held.seed !== true) return Effect.succeed({ facet: standing, value: false });
      const { seed: _sown, ...unseeded } = held;
      return Effect.succeed({ facet: { ...standing, session: unseeded }, value: true });
    });
    if (!sown) return none;
    const guided: Guided = { text };
    return guided;
  });

  return { prompt, touch, cleared, seed };
};
