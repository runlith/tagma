import { Effect } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { BirthConflict, birthKeyed } from '@runlith/agent/collaboration/threads';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { madeIn, MadeBirths, Placing } from './placement.js';
import { holdThreadResources } from '../resources/hold.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadInbox } from '../store/inbox.js';
import { ThreadResources } from '../store/resources.js';
import { HarnessBirthRows } from '../contract/service/birth.js';
import { SessionLookupStore } from '../store/sessionLookups.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { HARNESS_AGENT_ID } from '../contract/wire/harness/names.js';
import { SessionBirthWriting } from '../contract/service/sessionBirths.js';

export const makeExternalBirthRows = Effect.gen(function* () {
  const births = yield* HarnessBirthRows;
  const lookups = yield* SessionLookupStore;
  const records = yield* ThreadRecords;
  const inbox = yield* ThreadInbox;
  const { storage } = yield* ThreadResources;
  const rollouts = yield* ThreadRollouts;
  const placement = yield* Placing;
  const made = yield* MadeBirths;

  return SessionBirthWriting.of({
    create: (input, commit) =>
      births.transaction((unit) =>
        Effect.flatMap(
          births.insert({ ...input, provider: 'external', account: null, model: null, reasoning: null, switches: {} }, unit),
          (row) => commit(row, unit),
        ),
      ),
    adopt: Effect.fn('SessionBirthWriting.adopt')(function* (input) {
      const birth = yield* births.transaction((unit) =>
        Effect.gen(function* () {
          const standing = yield* lookups.keyed(input.projectId, input.harness, input.key, unit);
          if (standing !== null) return { threadId: standing, born: false };
          const label = input.label;
          const taken = yield* records.namesIn(input.projectId, unit);
          const name = [label, ...Array.from({ length: taken.size }, (_, at) => `${label} ${at + 2}`)].find(
            (candidate) => !taken.has(candidate),
          );
          const row = yield* births.insert(
            {
              ownerId: OPERATOR_PRINCIPAL,
              authority: { mode: input.mode, bypassFrom: null },
              agentId: HARNESS_AGENT_ID,
              provider: 'external',
              account: null,
              model: null,
              reasoning: null,
              switches: {},
            },
            unit,
          );
          yield* births.attachFacet(
            {
              threadId: row.id,
              projectId: input.projectId,
              createdBySessionId: null,
              name,
              harness: { facet: { ...input.seat.facet, sessionKey: input.key }, kernel: input.seat.kernel },
            },
            unit,
          );
          yield* holdThreadResources(storage, { threadId: row.id, projectId: input.projectId }, unit);
          if (input.place !== undefined) yield* placement.planted(unit, { threadId: row.id, root: input.place });
          return { threadId: row.id, born: true };
        }),
      );
      if (birth.born) yield* rollouts.ensure(birth.threadId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
      return birth;
    }),
    spawned: Effect.fn('SessionBirthWriting.spawned')(function* (input, seat, place) {
      const request = input.request;
      const root = request.root === true;
      const parent = yield* births.find(input.creatorThreadId);
      if (!parent)
        return yield* new GateRefusal('thread-project-missing', `Thread ${input.creatorThreadId} is gone.`, [
          'spawn from a thread that stands',
        ]);
      if (request.host !== null || parent.hostKind !== null)
        return yield* new GateRefusal('harness-host', 'Interactive external harnesses run in the local project workspace.', [
          'start the external harness in the local workspace',
        ]);
      const provision = input.provision;
      const child = yield* births.transaction((unit) =>
        Effect.gen(function* () {
          const standing = yield* inbox.receipt(provision.id, unit);
          if (standing) {
            const existing = yield* births.find(standing.threadId, unit);
            const home = place?.projectId ?? (yield* records.projectOf(parent.id, unit));
            if (
              !existing ||
              (root ? existing.createdBy : existing.parentThreadId) !== parent.id ||
              (yield* records.projectOf(existing.id, unit)) !== home ||
              standing.kind !== 'task' ||
              standing.body.text !== provision.body.text ||
              (request.name !== null && existing.name !== request.name) ||
              !Bun.deepEquals(existing.bindings, request.bindings ?? {})
            )
              return yield* new BirthConflict({ childId: existing?.id ?? standing.threadId, key: request.key, reason: 'spawn-conflict' });
            return { row: existing, acted: false };
          }
          if (request.name !== null && !root) {
            const held = yield* births.findNamed(parent.spawnRootId, parent.ownerId, request.name, unit);
            if (held) return yield* new BirthConflict({ childId: held.id, key: request.key, reason: 'name-taken' });
          }
          const values = {
            id: input.childId,
            ownerId: parent.ownerId,
            agentId: HARNESS_AGENT_ID,
            provider: 'external',
            model: null,
            reasoning: null,
            bornOf: input.bornOf,
            name: request.name ?? undefined,
            bindings: request.bindings,
            authority: input.authority,
          };
          const row = root
            ? yield* births.insert({ ...values, createdBy: parent.id }, unit)
            : yield* births.insertChild(parent.id, { ...values, spawnedByRunId: input.spawnedByRunId }, unit);
          const projectId = yield* births.inheritFacet(
            {
              threadId: row.id,
              fromThreadId: parent.id,
              agentId: HARNESS_AGENT_ID,
              harness: seat,
              carried: 'fresh',
              isRoot: false,
              title: request.title,
              projectId: place?.projectId === undefined ? undefined : place.projectId,
            },
            unit,
          );
          if (projectId === undefined)
            return yield* new GateRefusal('thread-project-missing', 'The parent has no project.', ['open the parent in a project']);
          yield* holdThreadResources(storage, { threadId: row.id, projectId }, unit);
          yield* placement.born(unit, {
            threadId: row.id,
            parentThreadId: parent.id,
            lineage: root ? 'branch' : 'child',
            guest: false,
            place,
          });
          yield* inbox.put({ ...provision, threadId: row.id }, unit, birthKeyed(parent.id, request).digest);
          return { row, acted: true };
        }),
      );
      if (!child.acted) return { threadId: child.row.id, acted: false };
      yield* rollouts.ensure(child.row.id).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
      const rootId = madeIn(input.place);
      if (rootId !== null) yield* made.announce(child.row.id, rootId);
      return { threadId: child.row.id, acted: true };
    }),
  });
});
