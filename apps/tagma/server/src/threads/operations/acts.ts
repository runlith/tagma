import { Effect } from 'effect';
import { OPERATOR_PRINCIPAL, threadIdOf } from '../../platform/contract/wire/actor.js';
import { ThreadLookup } from '../contract/service/reads.js';
import { TAGMA_APP_BINDING } from '../contract/wire/tagmaAppEndings.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair, type RefusalOf } from '../../platform/contract/service/body.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';
import type { ThreadTitleAnswer } from '../contract/wire/titles.js';
import { ThreadAdjustments } from '../turns/adjustments.js';
import { ThreadTurns } from '../turns/acts.js';
import { ThreadList } from '../contract/service/list.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { ThreadMoves } from '../targets/moves.js';
import { MAIN_WORKTREE } from '../birth/placement.js';
import { ThreadTitles } from '../contract/service/titles.js';
import { threadSelectionOf, wireSnapshotPayload } from '../list/wire.js';
import type { CacheWarmth } from '../contract/service/evidence.js';
import type { ContextLimits } from '../contract/service/limits.js';
import { stateThreads, threadBasis } from '../list/basis.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { THREAD_OPERATIONS } from '../contract/wire/operations/catalog.js';
import { answering } from './answering.js';
import type { ThreadRelation } from '../../thread-record/contract/wire/record.js';
import { ThreadRecords, strangerRaised } from '../../thread-record/contract/service/records.js';
import type { Raised } from '@runlith/agent/permissions';
import type { ArchiveTerms } from '../contract/wire/operations/catalog.js';
import { ThreadTeams, type TeamPlace } from '../contract/service/team.js';
import { gated, gateProject } from '../projectGate.js';

type TitleAnswer = DeclaredAnswer<(typeof OPS)['generate_thread_title']['answer']>;

const titleAnswer = (result: ThreadTitleAnswer, threadId: string): TitleAnswer => {
  const at = { ...result, threadId };
  switch (result.outcome) {
    case 'named':
      return { ...at, status: 'named' };
    case 'no-topic':
      return { ...at, status: 'no-topic' };
    case 'superseded':
      return { ...at, status: 'superseded' };
    case 'failed':
      return { ...at, status: 'failed' };
  }
};

const OPS = THREAD_OPERATIONS;

const UNASKED: ArchiveTerms = { relation: null, consents: [] };

const archiveConsents = (threadId: string, asking: string, relation: ThreadRelation, working: readonly string[]): readonly Raised[] => {
  const others = working.filter((id) => id !== asking);
  return [
    ...(relation === 'lineage'
      ? [
          {
            condition: 'own-lineage',
            fact: `${threadId === asking ? 'this is the calling thread itself' : `${threadId} is an ancestor of the calling thread`}: it is put away with everything under it, and the calling run goes on to its end`,
          },
        ]
      : []),
    ...(relation !== 'subtree' && others.length > 0
      ? [
          {
            condition: 'thread-running',
            fact: `${others.join(', ')} ${others.length === 1 ? 'is' : 'are'} working: stopped before ${threadId} is put away`,
          },
        ]
      : []),
  ];
};

const sweepTerms = ({ archived: _direction, project: _project, ...clocks }: (typeof OPS.archive_threads.input)['Type']) =>
  Effect.map(threadSelectionOf(clocks), ({ view: _view, ...terms }) => terms);

export const ACT_PAIRS = {
  continue_thread: pair(
    OPS.continue_thread,
    body(OPS.continue_thread, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const turns = yield* ThreadTurns;
        const continued = yield* answering('continue_thread', turns.continueThread(input.threadId, call.project.id));
        return 'status' in continued ? continued : { status: 'started' as const, runId: continued.runId };
      }),
    }),
  ),

  restart_thread: pair(
    OPS.restart_thread,
    body(OPS.restart_thread, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const turns = yield* ThreadTurns;
        const restarted = yield* answering(
          'restart_thread',
          turns.restart(input.threadId, call.project.id, threadIdOf(caller.actor) ?? undefined),
        );
        return { status: 'restarted' as const, ...restarted };
      }),
    }),
  ),

  move_thread: pair(
    OPS.move_thread,
    body<typeof OPS.move_thread, readonly Raised[], ThreadRecords | CurrentProject | ThreadMoves>(OPS.move_thread, {
      prepare: (input, caller: Caller) =>
        strangerRaised(
          input.threadId,
          threadIdOf(caller.actor),
          `it moves into ${input.worktree ?? MAIN_WORKTREE}${input.home === undefined ? '' : ` of project ${input.home}`} anyway`,
        ),
      execute: Effect.fnUntraced(function* (input, consents: readonly Raised[], caller) {
        const call = yield* yield* CurrentProject;
        const moves = yield* ThreadMoves;
        const advertised: readonly string[] = OPS.move_thread.refusals;
        return yield* moves
          .move(call.project.id, caller.actor, {
            threadId: input.threadId,
            worktree: input.worktree ?? MAIN_WORKTREE,
            home: input.home,
            operationKey: input.operationKey,
            expectedSelectionRevision: input.expectedSelectionRevision,
            expectedGeneration: input.expectedGeneration,
            reach: consents.length === 0 ? undefined : ('consented' as const),
          })
          .pipe(
            Effect.catch((refusal) =>
              Effect.fail<GateRefusal<RefusalOf<typeof OPS.move_thread>>>(
                advertised.includes(refusal.code)
                  ? (refusal as GateRefusal<RefusalOf<typeof OPS.move_thread>>)
                  : new GateRefusal('worktree-unavailable', refusal.reason, refusal.unblock),
              ),
            ),
          );
      }),
    }),
  ),

  archive_thread: pair(
    OPS.archive_thread,
    body(OPS.archive_thread, {
      prepare: Effect.fn('archive_thread.prepare')(function* (input, caller: Caller) {
        if (caller.actor.kind !== 'thread' || input.archived === false) return UNASKED;
        const asking = caller.actor.threadId;
        const list = yield* ThreadList;
        const relation = yield* answering('archive_thread', list.relation(input.threadId, asking));
        const working = yield* answering('archive_thread', list.working(input.threadId));
        const terms: ArchiveTerms = { relation, consents: archiveConsents(input.threadId, asking, relation, working) };
        return terms;
      }),
      execute: Effect.fnUntraced(function* (input, _terms: ArchiveTerms, caller) {
        const call = yield* yield* CurrentProject;
        if (caller.actor.kind === 'external') {
          const app = caller.actor.name.startsWith('app:') ? caller.actor.name.slice('app:'.length) : '';
          if (app === '') {
            return yield* new GateRefusal('external-refused', 'Archiving externally requires an app caller.', [
              'call as app:<id>, or ask the operator to archive the thread',
            ]);
          }
          const target = yield* answering('archive_thread', (yield* ThreadLookup).find(input.threadId, OPERATOR_PRINCIPAL));
          if (target === undefined) {
            return yield* new GateRefusal('not-found', `No thread ${input.threadId} stands in this project.`, [
              "read the project's thread list",
            ]);
          }
          if (target.projectId !== call.project.id) {
            return yield* new GateRefusal('foreign-project', `Thread ${input.threadId} stands in project ${target.projectId}.`, [
              `call archive_thread in project ${target.projectId}`,
            ]);
          }
          if (target.bindings[TAGMA_APP_BINDING] !== app) {
            return yield* new GateRefusal('app-thread-mismatch', `Thread ${input.threadId} is not bound to app ${app}.`, [
              `archive a thread whose bindings.app names ${app}, or ask the operator to archive this thread`,
            ]);
          }
        }
        const row =
          (input.archived ?? true)
            ? yield* answering('archive_thread', (yield* ThreadTurns).archive(input.threadId, call.project.id, caller.actor))
            : yield* answering('archive_thread', (yield* ThreadList).setArchived(input.threadId, call.project.id, false));
        return { status: (input.archived ?? true) ? ('archived' as const) : ('unarchived' as const), threadId: row.id };
      }),
    }),
  ),

  delete_thread: pair(
    OPS.delete_thread,
    body(OPS.delete_thread, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const turns = yield* ThreadTurns;
        const ended = yield* answering(
          'delete_thread',
          Effect.map(turns.delete(input.threadId, call.project.id, caller.actor), (deleted) => ({ deleted })),
        );
        if (!ended.deleted) {
          return yield* new GateRefusal('not-found', `No thread ${input.threadId} stands in this project.`, [
            "read the project's thread list",
          ]);
        }
        return { status: 'deleted' as const, threadId: input.threadId };
      }),
    }),
  ),

  archive_threads: pair(
    OPS.archive_threads,
    body(OPS.archive_threads, {
      prepare: Effect.fn('archive_threads.prepare')(function* (input, caller: Caller) {
        if (caller.actor.kind !== 'thread') return null;
        const callerId = caller.actor.threadId;
        const call = yield* yield* CurrentProject;
        const list = yield* ThreadList;
        return yield* answering(
          'archive_threads',
          Effect.flatMap(sweepTerms(input), (terms) => list.sweepRelation(call.project.id, terms, input.archived ?? true, callerId)),
        );
      }),
      execute: Effect.fnUntraced(function* (input, _relation: ThreadRelation | null, caller) {
        const call = yield* yield* CurrentProject;
        const list = yield* ThreadList;
        const sweep = yield* answering(
          'archive_threads',
          Effect.flatMap(sweepTerms(input), (terms) =>
            list.setArchivedMatching(call.project.id, terms, input.archived ?? true, caller.actor),
          ),
        );
        return { status: (input.archived ?? true) ? ('swept' as const) : ('restored' as const), ...sweep };
      }),
    }),
  ),

  pin_thread: pair(
    OPS.pin_thread,
    body(OPS.pin_thread, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const list = yield* ThreadList;
        const row = yield* answering('pin_thread', list.setPinned(input.threadId, call.project.id, input.pinned ?? true));
        return { status: (input.pinned ?? true) ? ('pinned' as const) : ('unpinned' as const), threadId: row.id };
      }),
    }),
  ),

  set_thread_delegation: pair(
    OPS.set_thread_delegation,
    body(OPS.set_thread_delegation, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const call = yield* yield* CurrentProject;
        const target = input.threadId ?? threadIdOf(caller.actor);
        if (target === null) {
          return yield* new GateRefusal('thread-required', 'This caller is not a thread, so it has no own thread to switch.', [
            'name the thread with `threadId`',
          ]);
        }
        const adjustments = yield* ThreadAdjustments;
        const answered = yield* answering('set_thread_delegation', adjustments.setDelegation(target, call.project.id, input.delegation));
        const switched = { threadId: target, ...answered };
        return {
          status: 'switched' as const,
          delegation: switched.allowed ? ('on' as const) : ('off' as const),
          threadId: switched.threadId,
          own: switched.own,
          setAt: switched.setAt,
          decidedBy:
            switched.setAt === null
              ? 'the machine switch agent.delegation'
              : switched.setAt === switched.threadId
                ? 'this thread'
                : `ancestor ${switched.setAt}`,
        };
      }),
    }),
  ),

  set_thread_approves: pair(
    OPS.set_thread_approves,
    body(OPS.set_thread_approves, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const adjustments = yield* ThreadAdjustments;
        const reading = yield* answering('set_thread_approves', adjustments.setApproves(input.threadId, call.project.id, input.approves));
        return {
          status: 'set' as const,
          threadId: input.threadId,
          own: reading.own,
          approves: reading.effective,
          origin: reading.origin,
          setAt: reading.setAt,
        };
      }),
    }),
  ),

  read_team: pair(
    OPS.read_team,
    body(OPS.read_team, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const records = yield* ThreadRecords;
        const teams = yield* ThreadTeams;
        const threadId = input.threadId ?? null;
        if (threadId !== null) yield* answering('read_team', gateProject(records, threadId, call.project.id));
        const unread = (failure: { readonly message: string }) =>
          Effect.fail(new GateRefusal('token-store', `The connected accounts could not be read: ${failure.message}`, ['try again']));
        const resolved = (place: TeamPlace) =>
          Effect.flatMap(teams.layers(place), (layers) => Effect.map(teams.of(place, layers), (team) => ({ layers, team }))).pipe(
            Effect.catchTags({ TokenStoreFailed: unread, CredentialFileFailed: unread, CredentialFileInvalid: unread }),
          );
        const projectId = threadId === null && input.layer === 'user' ? undefined : call.project.id;
        const { layers, team } = yield* resolved({ threadId, projectId, copy: input.team });
        const nearest = layers.thread.nearest;
        const project =
          nearest === null && input.team === undefined ? team : (yield* resolved({ threadId: null, projectId: call.project.id })).team;
        const differs = JSON.stringify(project) !== JSON.stringify(team);
        return {
          status: 'read' as const,
          threadId,
          team,
          edits: layers.edits,
          differs,
          own: layers.thread.own,
          setAt: nearest?.setAt ?? null,
        };
      }),
    }),
  ),

  set_thread_team: pair(
    OPS.set_thread_team,
    body(OPS.set_thread_team, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const records = yield* ThreadRecords;
        const teams = yield* ThreadTeams;
        const lineage = yield* answering(
          'set_thread_team',
          gated(records, input.threadId, call.project.id, () => teams.set(input.threadId, input.team)),
        );
        return { status: 'set' as const, threadId: input.threadId, own: lineage.own, setAt: lineage.nearest?.setAt ?? null };
      }),
    }),
  ),

  promote_thread_team: pair(
    OPS.promote_thread_team,
    body(OPS.promote_thread_team, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const records = yield* ThreadRecords;
        const teams = yield* ThreadTeams;
        if ('team' in input) {
          const adopted = yield* answering('promote_thread_team', teams.adopt(input.team, call.project.id));
          return { status: 'promoted' as const, threadId: null, ...adopted };
        }
        const promotion = yield* answering(
          'promote_thread_team',
          gated(records, input.threadId, call.project.id, () => teams.promote(input.threadId, call.project.id)),
        );
        return { status: 'promoted' as const, threadId: input.threadId, ...promotion };
      }),
    }),
  ),

  set_thread_approver: pair(
    OPS.set_thread_approver,
    body(OPS.set_thread_approver, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const adjustments = yield* ThreadAdjustments;
        const approver = yield* answering('set_thread_approver', adjustments.setApprover(input.threadId, call.project.id, input.approver));
        return { status: 'set' as const, threadId: input.threadId, approver };
      }),
    }),
  ),

  set_thread_operator_notice: pair(
    OPS.set_thread_operator_notice,
    body<typeof OPS.set_thread_operator_notice, readonly Raised[], ThreadRecords | CurrentProject | ThreadAdjustments>(
      OPS.set_thread_operator_notice,
      {
        prepare: (input, caller: Caller) =>
          strangerRaised(input.threadId, threadIdOf(caller.actor), "whether the operator's words to it wake this thread changes anyway"),
        execute: Effect.fnUntraced(function* (input) {
          const call = yield* yield* CurrentProject;
          const adjustments = yield* ThreadAdjustments;
          const notice = yield* answering(
            'set_thread_operator_notice',
            adjustments.setOperatorNotice(input.threadId, call.project.id, input.notice),
          );
          return { status: 'set' as const, threadId: input.threadId, notice };
        }),
      },
    ),
  ),

  set_thread_title: pair(
    OPS.set_thread_title,
    body<typeof OPS.set_thread_title, readonly Raised[], ThreadRecords | CurrentProject | ThreadAdjustments | CacheWarmth | ContextLimits>(
      OPS.set_thread_title,
      {
        prepare: (input, caller: Caller) => strangerRaised(input.threadId, threadIdOf(caller.actor), 'its title changes anyway'),
        execute: Effect.fnUntraced(function* (input) {
          const call = yield* yield* CurrentProject;
          const adjustments = yield* ThreadAdjustments;
          return yield* answering(
            'set_thread_title',
            Effect.gen(function* () {
              const snapshot = yield* adjustments.setTitle(input.threadId, call.project.id, input.title);
              return wireSnapshotPayload(snapshot, yield* threadBasis(stateThreads(snapshot, call.project.id)));
            }),
          );
        }),
      },
    ),
  ),

  generate_thread_title: pair(
    OPS.generate_thread_title,
    body(OPS.generate_thread_title, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const naming = yield* ThreadTitles;
        const result = yield* answering('generate_thread_title', naming.generate(input.threadId, call.project.id));
        return titleAnswer(result, input.threadId);
      }),
    }),
  ),

  repair_thread_rollout: pair(
    OPS.repair_thread_rollout,
    body(OPS.repair_thread_rollout, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const rollouts = yield* ThreadRollouts;
        const repaired = yield* answering('repair_thread_rollout', rollouts.repair(input.threadId, call.project.id));
        return { status: 'ok' as const, repaired };
      }),
    }),
  ),
};
