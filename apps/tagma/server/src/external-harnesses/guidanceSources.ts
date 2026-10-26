import { Context, Effect } from 'effect';
import type { GuidanceSources, GuidedWords } from '@runlith/agent/thread/transport/contract';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { Orientation } from '../graph/contract/service/orientation.js';
import { ServedGraphs } from '../graph/contract/service/serving.js';
import type { InstructionSet } from '../graph/contract/wire/instructions.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { threadCallFailed } from '../threads/contract/service/failure.js';
import { OperatorNotes } from '../threads/contract/service/notes.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { NOTES_RULE } from '../threads/contract/wire/notes.js';
import { sectionContext } from '../threads/doctrine/render.js';
import { teamLaw } from './installs/teamLaw.js';
import { instructionDelivery } from './instructions.js';
import { profileOf } from './protocol/links.js';
import type { HomePlace, SessionHome } from './sessions/place.js';
import type { HarnessSessionStore } from './store/sessions.js';

export const makeGuidanceSources = Effect.fnUntraced(function* (store: HarnessSessionStore, place: SessionHome) {
  const graphs = yield* ServedGraphs;
  const places = yield* WorkPlaces;
  const records = yield* ThreadRecords;
  const operatorNotes = yield* OperatorNotes;
  const instructions = Effect.fn('HarnessGuidance.instructions')(function* (threadId: string, known?: HomePlace) {
    const home = known ?? (yield* place(threadId));
    const origins = [{ projectId: home.projectId, root: home.root }, ...(yield* places.held(threadId))];
    const sets: InstructionSet[] = [];
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
      sets.push(
        yield* Context.get(served.context, Orientation)
          .instructions({ projectId: origin.projectId, audience: 'graph' })
          .pipe(Effect.provide(served.context)),
      );
    }
    return { sets, unavailable };
  });
  const nameOf = (threadId: string) =>
    Effect.flatMap(store.read(threadId), (facet) =>
      facet === null || facet === undefined
        ? Effect.fail(new ThreadStorageFailed({ call: 'guidance', cause: `thread ${threadId} has no harness` }))
        : Effect.succeed(facet.name),
    );
  const sources: GuidanceSources = {
    orientation: Effect.fnUntraced(function* (thread: ThreadRow) {
      const name = yield* nameOf(thread.id);
      if (profileOf(name).hosts !== null) return { texts: [], law: null };
      const home = yield* place(thread.id);
      const current = yield* instructions(thread.id, home);
      const own = current.sets.find((set) => set.projectId === home.projectId);
      const served = yield* graphs.resolve({ projectId: home.projectId, cwd: home.root });
      yield* served.fresh();
      const text = yield* Context.get(served.context, Orientation)
        .render({ projectId: home.projectId, law: own })
        .pipe(Effect.provide(served.context));
      const foreign = yield* instructionDelivery(
        null,
        current.sets.filter((set) => set.projectId !== home.projectId),
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
      const name = yield* nameOf(thread.id);
      if (profileOf(name).hosts !== null) return { text: '', law: delivered };
      const current = yield* instructions(thread.id);
      const updated = yield* instructionDelivery(
        delivered ?? null,
        current.sets,
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
