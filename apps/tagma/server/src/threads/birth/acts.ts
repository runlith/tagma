import type { ThreadBornOf } from '@runlith/agent/protocol/birth';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { Cause, Context, Effect } from 'effect';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { ThreadCallBroke, type ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadCreateInput } from '@runlith/agent/thread/ThreadAggregate';
import type { AgentApprovalMode, ThreadBindings } from '@runlith/agent/contracts';
import { DELEGATION_OFF, delegationRefused } from '@runlith/agent/collaboration/CollaborationVoice';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import type { ModelSwitches } from '@runlith/llm/models/description';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { stored } from '../../platform/store/crossing.js';
import { failedAs } from '../contract/service/failure.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { NATIVE_HARNESS, type HarnessId } from '../../platform/contract/wire/session.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { NameProvenance } from '../../thread-record/contract/wire/name.js';
import { PROVISIONAL_NAME } from '../../worktrees/contract/wire/creation.js';
import type { NativeThreadSnapshot, NativeThreadState } from '../contract/service/state.js';
import { BirthFactWriting, BirthModelSelection } from '../contract/service/birth.js';
import { ThreadHarness } from '../contract/service/engine.js';
import { Sandboxes } from '../../sandbox/contract/service/sandboxes.js';
import { harnessOfTypeId } from '../contract/wire/harness/types.js';
import { HARNESS_AGENT_ID } from '../contract/wire/harness/names.js';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { birthApprovalMode, defaultType } from '../contract/wire/settings.js';
import { ownedProject } from '../projectGate.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { HarnessRegistry, harnessNotInstalled } from '../contract/service/harness.js';
import { ThreadResources } from '../store/resources.js';
import { ThreadMandate } from '../contract/service/mandate.js';
import { holdThreadResources } from '../resources/hold.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { NoteWriting } from '../journal/worktreeNotes.js';
import { TypeOffers } from '../library/types.js';
import { resolveDelegation } from './delegation.js';
import { registeredMode } from '../contract/service/modes.js';
import { Placing } from './placement.js';

export type ThreadBirthInput = {
  projectId: number;
  scopeBlockUuid?: string;
  type?: string;
  parent?: string;
  task?: string;
  host?: { readonly kind: string; readonly id: string };
  createdBySessionId: number | null;
  createdBy?: string;
  title?: string;
  name?: string;
  account?: string;
  switches?: ModelSwitches;
  bindings?: ThreadBindings;
  approvalMode?: AgentApprovalMode;
  delegation?: boolean;
  team?: TeamLayer;
  askedBy?: string;
  bornOf?: ThreadBornOf;
  worktree?: string;
  base?: string;
  worktreeName?: string;
  nameOrigin?: NameProvenance;
};

export class ThreadBirths extends Context.Service<
  ThreadBirths,
  { create(input: ThreadBirthInput): Effect.Effect<NativeThreadSnapshot, HarnessFailure> }
>()('tagma/threads/ThreadBirths') {}

export const makeThreadBirths = Effect.gen(function* () {
  const harness = yield* ThreadHarness;
  const facts = yield* BirthFactWriting;
  const mandate = yield* ThreadMandate;
  const records = yield* ThreadRecords;
  const rollouts = yield* ThreadRollouts;
  const models = yield* BirthModelSelection;
  const { storage: resources } = yield* ThreadResources;
  const types = yield* TypeOffers;
  const settings = yield* Settings;
  const harnesses = yield* HarnessRegistry;
  const providers = yield* ProviderRegistry;
  const placement = yield* Placing;
  const host = yield* Sandboxes;
  const notes = yield* NoteWriting;
  const modes = yield* ApprovalModes;
  const bound = (id: HarnessId) => Effect.mapError(harnesses.resolve(id), (missing) => harnessNotInstalled(missing.harness));
  const createThread = <T>(
    id: HarnessId,
    input: ThreadCreateInput,
    commit: (row: ThreadRow, unit: WriteUnit<'machine'>) => Effect.Effect<T, ThreadBorderFailed>,
  ) => Effect.flatMap(bound(id), (born) => born.born(input, commit));

  return ThreadBirths.of({
    create: Effect.fn('ThreadBirths.create')(function* (input) {
      if (input.askedBy !== undefined) {
        const asking = yield* stored('delegation')(resolveDelegation(mandate, settings, input.askedBy));
        if (!asking.allowed) {
          return yield* new GateRefusal(DELEGATION_OFF, delegationRefused(input.askedBy, asking), [
            'do the work in your own thread',
            'the operator switches it back on: /delegation on the thread, or agent.delegation for the machine',
          ]);
        }
      }
      const typeId = input.type ?? (yield* stored('defaultType')(settings.value(defaultType, input.projectId)));
      if (input.parent !== undefined) {
        if (input.task === undefined) {
          return yield* new GateRefusal('task-required', 'a child birth names its opening task', [
            'supply task; an empty string opens the child without sender text',
          ]);
        }
        if (
          input.title !== undefined ||
          input.scopeBlockUuid !== undefined ||
          input.account !== undefined ||
          input.switches !== undefined ||
          input.approvalMode !== undefined ||
          input.delegation !== undefined ||
          input.team !== undefined ||
          input.worktree !== undefined ||
          input.base !== undefined ||
          input.worktreeName !== undefined
        ) {
          return yield* new GateRefusal(
            'child-inherits',
            'a child inherits its scope, model selection, authority, delegation, sub-agent team and worktree through the spawn birth',
            [
              'create the child with parent, task, type and optional name or host',
              'an agent puts its child in another worktree with spawn_agent `worktree`',
            ],
          );
        }
        const home = yield* ownedProject(records, input.parent);
        yield* rollouts.rehydrate(input.parent);
        const child = yield* harness.collaboration.spawn({
          parentThreadId: input.parent,
          ownerId: OPERATOR_PRINCIPAL,
          requestId: crypto.randomUUID(),
          project: home === input.projectId ? undefined : input.projectId,
          bornOf: input.bornOf,
          agentId: typeId,
          task: input.task,
          name: input.name,
          host: input.host,
          bindings: input.bindings,
        });
        return yield* harness.reads.snapshot(child.threadId);
      }
      const harnessRoot = harnessOfTypeId(typeId);
      if (input.task !== undefined && harnessRoot === null) {
        return yield* new GateRefusal('parent-required', 'an opening task belongs to a child birth', [
          'name the parent, or create a root without task',
        ]);
      }
      const scopeBlockUuid = input.scopeBlockUuid;
      const offer = yield* types.resolveIn({
        projectId: input.projectId,
        caller: input.createdBySessionId === null ? 'operator' : 'agent',
        typeId,
      });
      if (!offer) {
        return yield* new GateRefusal('unknown-type', `no agent is offered here as ${typeId}`, [
          'read_settings — name a type this project offers you',
          `a thread opened without a type opens what ${defaultType.id} names: set it to a type this project offers`,
        ]);
      }
      if ('withheld' in offer) return yield* new GateRefusal('type-withheld', offer.withheld, offer.unblock);
      const harnessName = harnessOfTypeId(typeId);
      const preferred =
        harnessName === null
          ? null
          : yield* models
              .selection({})
              .pipe(
                Effect.catchTag('GateRefusal', (refusal) =>
                  refusal.code === 'no-model-connected' || refusal.code === 'no-provider' ? Effect.succeed(null) : Effect.fail(refusal),
                ),
              );
      const offered =
        harnessName === null
          ? null
          : yield* Effect.flatMap(bound(harnessName as HarnessId), (named) =>
              named.transportAt === undefined
                ? Effect.fail(new ThreadCallBroke({ cause: new Error(`${harnessName} answers no birth transport.`) }))
                : named.transportAt(input.projectId, preferred),
            );
      const carried =
        offered?.kernel == null
          ? offered
          : {
              ...offered,
              kernel: {
                ...offered.kernel,
                switches: yield* models.switches({ ...offered.kernel.selection, switches: input.switches }),
              },
            };
      const selected =
        harnessName !== null
          ? null
          : yield* models.selection({
              profile: offer.profile,
              account: input.account,
              switches: input.switches,
            });
      const hosting = selected === null ? null : yield* harnesses.seating(selected, (yield* providers.catalog).models);
      const harnessBirth = carried ?? (hosting === null ? null : yield* hosting.seat(offer.baseAgentId));
      const born =
        harnessBirth?.kernel !== null && harnessBirth?.kernel !== undefined
          ? { ...harnessBirth.kernel.selection, account: harnessBirth.kernel.account, switches: harnessBirth.kernel.switches }
          : (selected ?? { provider: 'external', account: null, model: null, reasoning: null, switches: {} });
      const begins = harnessRoot ?? hosting?.name ?? null;
      if (input.base !== undefined && input.worktree !== 'new') {
        return yield* new GateRefusal('base-without-new', 'a base names where a new worktree is cut from', [
          'name worktree `new` beside the base, or drop the base',
        ]);
      }
      if (input.worktreeName !== undefined && input.worktree !== 'new') {
        return yield* new GateRefusal('name-without-new', 'a worktree name names the branch of a new worktree', [
          'name worktree `new` beside the name, or drop the name',
          'rename a worktree that stands: rename_worktree',
        ]);
      }
      const mode =
        input.approvalMode ??
        offer.approvalMode ??
        (yield* stored('birthApprovalMode')(settings.value(birthApprovalMode, input.projectId)));
      yield* registeredMode(modes, mode);
      const chosen = input.title ?? (input.nameOrigin === 'generated' ? undefined : input.name);
      const place =
        input.worktree === undefined
          ? undefined
          : yield* placement.resolve({
              projectId: input.projectId,
              worktree: input.worktree,
              from: null,
              operationId: `start:${crypto.randomUUID()}`,
              name: chosen ?? PROVISIONAL_NAME,
              base: input.base,
              branch: input.worktreeName,
              agent: input.createdBySessionId !== null,
              asked: false,
              guest: input.host !== undefined,
            });
      const unborn = <A, E, R>(birth: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        place === undefined ? birth : Effect.onError(birth, () => placement.abandoned(place));
      const created = yield* unborn(
        createThread(
          harnessBirth === null ? (NATIVE_HARNESS as HarnessId) : (harnessBirth.facet.name as HarnessId),
          {
            ownerId: OPERATOR_PRINCIPAL,
            createdBy: input.createdBy ?? input.askedBy ?? (input.createdBySessionId === null ? OPERATOR_PRINCIPAL : null),
            authority: { mode, bypassFrom: null },
            agentId: hosting === null ? offer.baseAgentId : HARNESS_AGENT_ID,
            profile: offer.profile ? { id: offer.profile.id, overlay: offer.profile } : undefined,
            hostKind: input.host?.kind,
            hostId: input.host?.id,
            bindings: input.bindings,
            bornOf: input.bornOf,
            ...born,
          },
          (thread, tx) =>
            failedAs(
              'attachFacet',
              Effect.tap(
                facts.attach(
                  {
                    createdBySessionId: input.createdBySessionId,
                    threadId: thread.id,
                    projectId: input.projectId,
                    scopeBlockUuid,
                    title: chosen,
                    name: chosen !== undefined || input.name === undefined ? undefined : input.name,
                    harness: harnessBirth ?? undefined,
                    delegation: input.delegation,
                    team: input.team,
                  },
                  tx,
                ),
                () =>
                  holdThreadResources(resources, { threadId: thread.id, projectId: input.projectId }, tx).pipe(
                    Effect.andThen(
                      input.host === undefined
                        ? Effect.void
                        : host.admit(
                            {
                              host: input.host,
                              child: thread,
                              projectId: input.projectId,
                              carried: 'fresh',
                            },
                            tx,
                          ),
                    ),
                    Effect.andThen(
                      place === undefined
                        ? Effect.void
                        : placement.planted(tx, {
                            threadId: thread.id,
                            root: place,
                            provisional: place.made && chosen === undefined && input.worktreeName === undefined,
                          }),
                    ),
                  ),
              ),
            ),
        ),
      );
      if (input.host !== undefined) {
        const readiness = yield* Effect.exit(host.ready(created));
        if (readiness._tag === 'Failure') {
          return yield* new GateRefusal(
            'host-not-ready',
            `thread ${created.id} was born against ${input.host.kind} ${input.host.id}, but the host did not come up: ${Cause.pretty(readiness.cause)}`,
            [`delete_thread ${created.id} to free the host`, `open a turn on thread ${created.id} to try the host again`],
          );
        }
      }
      yield* rollouts.ensure(created.id).pipe(Effect.orDie);
      if (place?.made === true) yield* notes.created(created.id, place.rootId);
      if (begins !== null && input.task !== undefined) {
        const handle = harness.threads.handle(created.id, OPERATOR_PRINCIPAL);
        if (input.task.trim() !== '') yield* handle.begin(input.task);
        else {
          const seated = yield* Effect.exit(handle.seat());
          if (seated._tag === 'Failure') {
            return yield* new GateRefusal(
              'cli-not-started',
              `thread ${created.id} was born, but its process did not start: ${Cause.pretty(seated.cause)}`,
              [`send words to thread ${created.id} to start it again`, `delete_thread ${created.id}`],
            );
          }
        }
      }
      return yield* harness.reads.snapshot(created.id);
    }),
  });
});
