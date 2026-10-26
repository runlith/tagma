import { Effect } from 'effect';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import type { Raised } from '@runlith/agent/permissions';
import { BlockNames } from '../../graph/contract/service/acts.js';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { Tasks } from '../../graph/contract/service/work.js';
import { heldRaised } from '../../graph/contract/wire/operations/shared.js';
import { blockName } from '../../graph/contract/wire/references.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { workStart } from '../../graph/contract/wire/threadWork.js';
import { GraphScopes } from '../../graph/contract/service/serving.js';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { MachineWriters, SignedSession } from '../../platform/contract/service/writers.js';
import { birthOf } from '../../platform/contract/wire/actor.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { ThreadBirths } from '../birth/acts.js';
import { AgentLibrary } from '../contract/service/library.js';
import { InstalledHarnesses } from '../contract/service/harness.js';
import { rowThreads, stateThreads, threadBasis } from '../list/basis.js';
import { ROUTE_OPERATIONS as OPS, type RouteOperationId } from '../contract/wire/operations/routes.js';
import { ThreadList } from '../contract/service/list.js';
import { defaultType } from '../contract/wire/settings.js';
import { Settings } from '../../settings/contract/service/values.js';
import { wireSnapshotPayload, threadSelectionOf, wireThread, wireThreadListWindow } from '../list/wire.js';
import { declaredRefusals } from '../refusalAnswers.js';
import { harnessRefusal } from '../refusals.js';
import { ThreadDetachment } from '../collaboration/detachment.js';
import { CallerAim, CallPlace } from '../../platform/contract/service/place.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { WorkPlaces } from '../contract/service/working.js';
import { GraphRecoveries } from '../../graph/contract/service/recovery.js';
import { ThreadTurns } from '../turns/acts.js';
import { admitCallerOf } from '../turns/caller.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';

const workTask = (name: string, title: string, taken: boolean) =>
  taken
    ? `Take on [[${name}]] — ${title}. It is already held in your name: read it whole with read_block, then do it.`
    : `Build [[${name}]] — ${title}: read it whole with read_block, then do the work it agrees.`;

const bornOn = Effect.fnUntraced(function* (name: string) {
  const row = yield* (yield* Blocks).rawBlockById(yield* (yield* BlockNames).idOfName(name));
  const table = yield* (yield* Tags).of(row.projectId);
  const start = workStart(table, row);
  if (start === null && table.isTerminal(row)) {
    return yield* new GateRefusal('illegal-status', `${blockName(row.uuid)} is ${table.statusOf(row)}: its work has ended`, [
      `reopen ${blockName(row.uuid)} first, or start the agent on open work`,
    ]);
  }
  return { row, taken: start !== 'build', holder: table.holderOf(row) };
});

type Birth = { readonly asked: readonly Raised[]; readonly over: number | null | undefined };

const bornWork = Effect.fnUntraced(function* (
  threadId: string,
  projectId: number,
  name: string,
  over: number | null | undefined,
  actor: Caller['actor'],
) {
  const work = yield* bornOn(name);
  if (work.taken) {
    yield* (yield* Tasks).claim({ id: work.row.id, as: { harness: NATIVE_HARNESS, key: threadId }, over });
    const place = yield* CallPlace;
    if (place?.checkout != null)
      yield* (yield* WorkPlaces).enter({
        threadId,
        home: projectId,
        place: { projectId: place.projectId, root: place.checkout },
        mutates: true,
      });
  }
  yield* (yield* ThreadTurns).send(threadId, projectId, workTask(blockName(work.row.uuid), work.row.title, work.taken), undefined, {
    key: `work:${threadId}`,
    caller: admitCallerOf(actor),
  });
});

export const ROUTE_PAIRS: { readonly [K in RouteOperationId]: OperationPair<(typeof OPS)[K]> } = {
  start_graph_recovery: pair(
    OPS.start_graph_recovery,
    body(OPS.start_graph_recovery, {
      execute: (input, _prepared, caller) =>
        declaredRefusals(OPS.start_graph_recovery)(
          Effect.gen(function* () {
            const { project } = yield* yield* CurrentProject;
            const requested = yield* CallerAim;
            const aim = { projectId: project.id, cwd: requested?.cwd, branch: input.branch };
            const recovery = yield* GraphRecoveries;
            const pending = yield* recovery.read(aim);
            if (pending === null || pending.id !== input.id)
              return yield* new GateRefusal('not-found', 'this graph recovery is no longer pending', ['read_graph_recovery']);
            const births = yield* ThreadBirths;
            const threadId = yield* recovery.assign(aim, input.id, (record) =>
              Effect.map(
                births.create({
                  projectId: project.id,
                  createdBySessionId: null,
                  title: `Graph recovery: ${record.incoming} → ${record.branch}`,
                  ...birthOf(caller.actor),
                }),
                (snapshot) => snapshot.thread.id,
              ),
            );
            const { threadId: _, ...diagnostic } = pending;
            const text = [
              `Восстанови слияние графа знаний проекта ${project.name}. Оператор поручил это действие из уведомления о конфликте.`,
              'Работай только в изолированном recovery directory, указанном в диагностике. Сохрани знания обеих сторон; смысловые противоречия, которые нельзя обоснованно решить, уточни у оператора.',
              'Прочитай файлы и обе стороны Git index, разреши конфликты правками файлов. Код проекта и обслуживаемое дерево графа не меняй. Git commit и публикацию выполняет resolve_graph_conflict.',
              `После исправлений вызови resolve_graph_conflict с branch ${JSON.stringify(pending.branch)}. Если target изменился, включи названный операцией commit в recovery tree и повтори завершение.`,
              'Диагностика (данные):',
              JSON.stringify(diagnostic, null, 2),
            ].join('\n\n');
            yield* (yield* ThreadTurns).send(threadId, project.id, text, undefined, {
              key: `graph-recovery:${pending.id}`,
              caller: admitCallerOf(caller.actor),
            });
            return { status: 'assigned' as const, threadId: ThreadId.make(threadId) };
          }),
        ),
    }),
  ),
  create_thread: pair(
    OPS.create_thread,
    body(OPS.create_thread, {
      prepare: Effect.fnUntraced(
        function* (input) {
          const asked: Raised[] = [];
          if (input.approvalMode !== undefined && (yield* (yield* MachineWriters).signedId()) !== null) {
            asked.push({
              condition: 'mode-withheld',
              fact: `the thread opens under ${input.approvalMode}, which is the operator's to name`,
            });
          }
          if (input.parent !== undefined) {
            const parent = yield* (yield* ThreadList).row(input.parent);
            if (parent?.archivedAt != null)
              asked.push({
                condition: 'thread-archived',
                fact: `${input.parent} is archived; the child stands in the thread list on its own once it starts its task`,
              });
          }
          if (input.work === undefined) return { asked, over: undefined } satisfies Birth;
          if (input.task !== undefined) {
            return yield* new GateRefusal(
              'work-with-task',
              'a thread born on work opens its first turn on that work, so it takes no task beside it',
              ['drop task: the first turn names the work', 'drop work and open the thread on the task alone'],
            );
          }
          const work = yield* bornOn(input.work);
          if (!work.taken) return { asked, over: undefined } satisfies Birth;
          const tasks = yield* Tasks;
          yield* tasks.claimable({ id: work.row.id });
          const held = yield* tasks.heldElsewhere(work.row);
          if (held !== null) asked.push(heldRaised(held, 'the new thread takes that work over'));
          return { asked, over: work.holder } satisfies Birth;
        },
        (work) => harnessRefusal(work, OPS.create_thread.refusals),
        Effect.catchTag('BodyMissing', (missing) => Effect.fail(new GateRefusal('not-found', missing.reason, missing.unblock))),
      ),
      execute: (input, prepared: Birth, caller) =>
        harnessRefusal(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const projectId = call.project.id;
            const scopes = yield* GraphScopes;
            const scopeBlockUuid =
              input.scopeName === undefined
                ? undefined
                : (yield* scopes.scope(projectId, yield* (yield* BlockNames).idOfName(input.scopeName))).uuid;
            const title = input.title?.trim();
            if (title === '') {
              return yield* new GateRefusal('title-empty', "a thread's name is its only handle in the list", [
                'create with a non-blank title, or without one from the operator surface',
              ]);
            }
            const createdBySessionId = yield* (yield* MachineWriters).signedId();
            const actor = caller.actor;
            if (createdBySessionId !== null && title === undefined && input.parent === undefined) {
              return yield* new GateRefusal('title-required', 'a thread born of an agent carries a name the operator can read', [
                'name it at creation: {"title": "<what this worker is for>"}',
              ]);
            }
            const created = yield* (yield* ThreadBirths).create({
              projectId,
              createdBySessionId,
              type: input.type,
              parent: input.parent,
              task: input.task,
              host: input.host,
              bindings: input.bindings,
              worktree: input.worktree,
              base: input.base,
              worktreeName: input.worktreeName,
              scopeBlockUuid,
              title,
              name: input.name,
              nameOrigin: input.nameOrigin,
              account: input.account,
              approvalMode: input.approvalMode,
              delegation: input.delegation,
              team: input.team,
              ...birthOf(actor),
              switches: input.switches,
            });
            if (input.work !== undefined) {
              const threadId = created.thread.id;
              const turns = yield* ThreadTurns;
              yield* bornWork(threadId, projectId, input.work, prepared.over, actor).pipe(
                Effect.tapError((failure) =>
                  turns
                    .delete(threadId, projectId)
                    .pipe(
                      Effect.mapError(
                        (kept) =>
                          new GateRefusal(
                            'born-without-work',
                            `the thread ${threadId} could not start on its work (${failure.message}), and it could not be removed either (${kept.message})`,
                            [
                              `delete_thread ${threadId} — remove the thread that stands without its work`,
                              'create the thread on the work again',
                            ],
                          ),
                      ),
                    ),
                ),
              );
            }
            const basis = yield* threadBasis(stateThreads(created, projectId));
            return wireSnapshotPayload(created, basis);
          }),
        ) as never,
    }),
  ),

  list_thread_types: pair(
    OPS.list_thread_types,
    body(OPS.list_thread_types, {
      execute: (input) =>
        declaredRefusals(OPS.list_thread_types)(
          Effect.gen(function* () {
            const installs = yield* InstalledHarnesses;
            yield* input.refresh === true ? installs.refresh : installs.settled;
            const call = yield* yield* CurrentProject;
            const signed = yield* SignedSession;
            const offered = yield* (yield* AgentLibrary).offered(call.project.id, signed === null ? 'operator' : 'agent');
            return {
              status: 'ok' as const,
              ...offered,
              default: yield* (yield* Settings).value(defaultType, call.project.id),
              modes: (yield* ApprovalModes).declared(),
            };
          }),
        ),
    }),
  ),

  list_thread_window: pair(
    OPS.list_thread_window,
    body(OPS.list_thread_window, {
      execute: (input) =>
        declaredRefusals(OPS.list_thread_window)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const selection = yield* threadSelectionOf(input);
            const window = yield* (yield* ThreadList).listWindow(call.project.id, selection.readerOrderAt?.before);
            const basis = yield* threadBasis(rowThreads(window.rows));
            return { status: 'ok' as const, ...wireThreadListWindow(window, basis) };
          }),
        ),
    }),
  ),

  locate_thread: pair(
    OPS.locate_thread,
    body(OPS.locate_thread, {
      execute: (input) =>
        declaredRefusals(OPS.locate_thread)(
          Effect.flatMap(
            Effect.flatMap(ThreadList, (list) => list.row(input.threadId)),
            (row) =>
              row
                ? Effect.succeed({ status: 'located' as const, projectId: row.projectId })
                : Effect.fail(
                    new GateRefusal('not-found', `Thread ${input.threadId} does not exist.`, [
                      'read the thread list of the project that holds it',
                    ]),
                  ),
          ),
        ),
    }),
  ),

  mark_thread_seen: pair(
    OPS.mark_thread_seen,
    body(OPS.mark_thread_seen, {
      execute: (input) =>
        declaredRefusals(OPS.mark_thread_seen)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const row = yield* (yield* ThreadList).see(input.threadId, call.project.id, input.runId);
            const basis = yield* threadBasis(rowThreads([row]));
            return { status: 'seen' as const, ...wireThread(row, basis) };
          }),
        ),
    }),
  ),

  detach_thread: pair(
    OPS.detach_thread,
    body(OPS.detach_thread, {
      execute: (input) =>
        declaredRefusals(OPS.detach_thread)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const detachment = yield* ThreadDetachment;
            if (input.detached === false) {
              return { status: 'reattached' as const, ...(yield* detachment.reattach(input.threadId, call.project.id)) };
            }
            return { status: 'detached' as const, ...(yield* detachment.detach(input.threadId, call.project.id)) };
          }),
        ),
    }),
  ),
};
