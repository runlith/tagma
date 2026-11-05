import { Context, Effect } from 'effect';
import type { GuidanceSources, GuidedWords } from '@runlith/agent/thread/transport/contract';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Orientation } from '../graph/contract/service/orientation.js';
import { ServedGraphs } from '../graph/contract/service/serving.js';
import type { InstructionDiff } from '../graph/contract/wire/instructions.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { threadCallFailed } from '../threads/contract/service/failure.js';
import { OperatorNotes } from '../threads/contract/service/notes.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { NOTES_RULE } from '../threads/contract/wire/notes.js';
import { sectionContext } from '../threads/doctrine/render.js';
import { teamLaw } from './installs/teamLaw.js';
import { type DeliveredLaw, deliveredLaw, instructionDelivery } from './instructions.js';
import { linkedOf } from './protocol/links.js';
import { HarnessAdapters } from './contract/service/adapters.js';
import type { HomePlace, SessionHome } from './sessions/place.js';
import type { HarnessSessionStore } from './store/sessions.js';

export const makeGuidanceSources = Effect.fnUntraced(function* (store: HarnessSessionStore, place: SessionHome) {
  const graphs = yield* ServedGraphs;
  const places = yield* WorkPlaces;
  const records = yield* ThreadRecords;
  const operatorNotes = yield* OperatorNotes;
  const adapters = yield* HarnessAdapters;
  const instructions = Effect.fn('HarnessGuidance.instructions')(function* (threadId: string, delivered: DeliveredLaw, known?: HomePlace) {
    const home = known ?? (yield* place(threadId));
    const origins = [{ projectId: home.projectId, root: home.root }, ...(yield* places.held(threadId))];
    const diffs: InstructionDiff[] = [];
    const unavailable: { projectId: number; text: string }[] = [];
    for (const origin of origins) {
      const opened = yield* Effect.result(places.graphAt(origin));
      if (opened._tag === 'Failure') {
        if (origin.projectId === home.projectId) return yield* opened.failure;
        yield* places.leave(threadId, origin.projectId);
        unavailable.push({
          projectId: origin.projectId,
          text: `The law of project ${origin.projectId} at ${origin.root} cannot be read: ${opened.failure.code}: ${opened.failure.reason}. Its place was released; the next act there will ask for its law again.`,
        });
        continue;
      }
      const served = opened.success;
      diffs.push(
        yield* Context.get(served.context, Orientation)
          .changes({ projectId: origin.projectId, audience: 'graph', previous: delivered[String(origin.projectId)] })
          .pipe(Effect.provide(served.context)),
      );
    }
    return { diffs, unavailable };
  });
  const hosted = (threadId: string) =>
    Effect.flatMap(store.read(threadId), (facet) =>
      facet === null || facet === undefined
        ? Effect.fail(new ThreadStorageFailed({ call: 'guidance', cause: `thread ${threadId} has no harness` }))
        : Effect.map(linkedOf(adapters, facet), ({ profile }) => profile.hosts !== null),
    );
  const sources: GuidanceSources = {
    orientation: Effect.fnUntraced(function* (thread: ThreadRow) {
      if (yield* hosted(thread.id)) return { texts: [], law: null };
      const home = yield* place(thread.id);
      const current = yield* instructions(thread.id, {}, home);
      const own = current.diffs.find((diff) => diff.set.projectId === home.projectId)?.set;
      const served = yield* graphs.resolve({ projectId: home.projectId, cwd: home.root });
      yield* served.fresh();
      const text = yield* Context.get(served.context, Orientation)
        .render({ projectId: home.projectId, law: own })
        .pipe(Effect.provide(served.context));
      const foreign = instructionDelivery(
        {},
        current.diffs.filter((diff) => diff.set.projectId !== home.projectId),
        thread.id,
      );
      const law = own === undefined ? foreign.law : { ...foreign.law, [String(home.projectId)]: own };
      return {
        texts: [
          text,
          teamLaw(sectionContext()),
          ...current.unavailable.map((place) => place.text),
          ...(foreign.text === '' ? [] : [foreign.text]),
        ],
        law,
      };
    }, Effect.mapError(threadCallFailed)),
    law: Effect.fnUntraced(function* (thread: ThreadRow, delivered: unknown) {
      if (yield* hosted(thread.id)) return { text: '', law: delivered };
      const known = yield* deliveredLaw(delivered ?? null);
      const current = yield* instructions(thread.id, known);
      const updated = instructionDelivery(
        known,
        current.diffs,
        thread.id,
        current.unavailable.map((place) => place.projectId),
      );
      return {
        law: updated.law,
        text: [...current.unavailable.map((place) => place.text), updated.text].filter((text) => text !== '').join('\n\n'),
      };
    }, Effect.mapError(threadCallFailed)),
    recap: (thread) =>
      records.facts(thread.id).pipe(
        Effect.map((facts) => {
          const standing = facts?.recap;
          if (standing === null || standing === undefined || standing.voided) return null;
          return standing.next === null ? standing.summary : `${standing.summary}\n\nNext: ${standing.next}`;
        }),
        Effect.mapError(threadCallFailed),
      ),
    tail: Effect.fnUntraced(function* (threadId: string, { projectId, inputs }: GuidedWords) {
      const { text } = yield* operatorNotes.standing({ projectId, threadId });
      return text === null ? null : { text, ruleId: NOTES_RULE, state: { [NOTES_RULE]: { inputs } } };
    }),
  };
  return sources;
});
