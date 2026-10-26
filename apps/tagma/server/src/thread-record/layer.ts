import { Cause, Effect, Exit, Layer } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../platform/contract/service/units.js';
import {
  type RecordAddress,
  type ShelfRecorded,
  type StatusPublished,
  ThreadRecords,
  type TitleRecorded,
} from './contract/service/records.js';
import type { ThreadId } from '../platform/contract/wire/thread.js';
import { insertRecord, removeRecords } from './birth.js';
import { detach, reattach } from './detachment.js';
import { addressOf, countIn, facts, namesIn, projectOf, projectsOf } from './identity.js';
import { isDescendant, relationOf, subtree } from './lineage.js';
import { harnessed, scope } from './scope.js';
import { advanceReaderOrder, setArchived, setPinned } from './shelf.js';
import { moveStatus } from './status.js';
import { adoptTitle, claimTitleInput, nameTitle, setTitle } from './titles.js';
import { voidRecap, writeRecap } from './recaps.js';
import { writes } from '../platform/contract/service/writes.js';
import { threadRecord as threadRecordTable } from './store/table.js';

const recording = writes('ThreadRecords', [threadRecordTable]);

type Subscriber<E> = (event: E) => Effect.Effect<void>;

const feed = <E>() => {
  const subscribers = new Set<Subscriber<E>>();
  return {
    publish: (unit: WriteUnit<'machine'>, event: E) =>
      unit.afterCommit(
        Effect.forEach(
          subscribers,
          (subscriber) =>
            Effect.flatMap(Effect.exit(Effect.suspend(() => subscriber(event))), (exit) =>
              Exit.isFailure(exit)
                ? Effect.logError('a committed record event subscriber failed', { event, cause: Cause.pretty(exit.cause) })
                : Effect.void,
            ),
          { discard: true },
        ),
      ),
    subscribe: (subscriber: Subscriber<E>) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
};

export const makeThreadRecords = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const births = feed<RecordAddress>();
  const removals = feed<RecordAddress>();
  const titles = feed<TitleRecorded>();
  const statuses = feed<StatusPublished>();
  const shelves = feed<ShelfRecorded>();
  const recorded = (unit: WriteUnit<'machine'>, id: string) => (revision: number | undefined) =>
    revision === undefined ? Effect.succeed(false) : Effect.as(titles.publish(unit, { threadId: id as ThreadId, revision }), true);
  return ThreadRecords.of({
    writes: recording,
    facts: (id, unit) => (unit ? facts(db, unit, id) : units.read((read) => facts(db, read, id))),
    projectOf: (id, unit) => (unit ? projectOf(db, unit, id) : units.read((read) => projectOf(db, read, id))),
    projectsOf: (ids) => units.read((read) => projectsOf(db, read, ids)),
    address: (address, from) => addressOf(db, address, from),
    countIn: (projectId) => units.read((read) => countIn(db, read, projectId)),
    namesIn: (projectId, unit) => namesIn(db, unit, projectId),
    isDescendant: (id, ancestorId, unit) =>
      unit ? isDescendant(db, unit, id, ancestorId) : units.read((read) => isDescendant(db, read, id, ancestorId)),
    relation: Effect.fn('ThreadRecords.relation')((id, callerId) => units.read((read) => relationOf(db, read, id, callerId))),
    subtree: (id, unit, excludingLineage) =>
      unit ? subtree(db, unit, id, excludingLineage) : units.read((read) => subtree(db, read, id, excludingLineage)),
    insert: Effect.fn('ThreadRecords.insert')((unit, birth) =>
      Effect.andThen(
        unit.run(insertRecord(db, birth)),
        birth.projectId == null ? Effect.void : births.publish(unit, { threadId: birth.id as ThreadId, projectId: birth.projectId }),
      ),
    ),
    scope: Effect.fn('ThreadRecords.scope')((unit, id, facts) =>
      Effect.flatMap(scope(db, unit, id, facts), (scoped) =>
        !scoped || facts.projectId === null
          ? Effect.succeed(scoped)
          : Effect.as(births.publish(unit, { threadId: id as ThreadId, projectId: facts.projectId }), true),
      ),
    ),
    harnessed: (unit, id, served) => harnessed(db, unit, id, served),
    remove: Effect.fn('ThreadRecords.remove')((unit, ids) =>
      Effect.flatMap(removeRecords(db, unit, ids), (removed) =>
        Effect.forEach(removed, (address) => removals.publish(unit, address), { discard: true }),
      ),
    ),
    publishStatus: Effect.fn('ThreadRecords.publishStatus')(function* (unit, id, move) {
      const moved = yield* moveStatus(db, unit, id, move);
      if (moved === undefined) return false;
      const { unshelved, ...status } = moved;
      yield* statuses.publish(unit, { threadId: id as ThreadId, ...status });
      if (unshelved) yield* shelves.publish(unit, { threadIds: [id as ThreadId] });
      return true;
    }),
    setArchived: (unit, ids, at) =>
      Effect.tap(setArchived(db, unit, ids, at), (moved) =>
        moved.length === 0 ? Effect.void : shelves.publish(unit, { threadIds: moved }),
      ),
    setPinned: (unit, id, at) => setPinned(db, unit, id, at),
    detach: Effect.fn('ThreadRecords.detach')((unit, id, at) => detach(db, unit, id, at)),
    reattach: Effect.fn('ThreadRecords.reattach')((unit, id) => reattach(db, unit, id)),
    advanceReaderOrder: (unit, id, at) =>
      Effect.flatMap(advanceReaderOrder(db, unit, id, at), (unshelved) =>
        unshelved ? shelves.publish(unit, { threadIds: [id as ThreadId] }) : Effect.void,
      ),
    setTitle: Effect.fn('ThreadRecords.setTitle')((unit, id, title, provenance) =>
      Effect.asVoid(Effect.flatMap(setTitle(db, unit, id, title, provenance), recorded(unit, id))),
    ),
    nameTitle: Effect.fn('ThreadRecords.nameTitle')((unit, id, title, expectedRevision) =>
      Effect.tap(nameTitle(db, unit, id, title, expectedRevision), (named) =>
        named.outcome === 'written' && named.after !== null
          ? titles.publish(unit, { threadId: id as ThreadId, revision: named.after.revision })
          : Effect.void,
      ),
    ),
    adoptTitle: Effect.fn('ThreadRecords.adoptTitle')((unit, id, title, expectedRevision, provenances) =>
      Effect.flatMap(adoptTitle(db, unit, id, title, expectedRevision, provenances), recorded(unit, id)),
    ),
    claimTitleInput: (unit, id, input) => claimTitleInput(db, unit, id, input),
    writeRecap: (unit, id, recap) => writeRecap(db, unit, id, recap),
    voidRecap: (unit, id, appearedAt) => voidRecap(db, unit, id, appearedAt),
    birthRecorded: births.subscribe,
    removalRecorded: removals.subscribe,
    titleRecorded: titles.subscribe,
    statusPublished: statuses.subscribe,
    shelfRecorded: shelves.subscribe,
  });
});

export const threadRecordsLayer = Layer.effect(ThreadRecords, makeThreadRecords);
