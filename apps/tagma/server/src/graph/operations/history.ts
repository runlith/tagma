import { Effect, Result, Schema } from 'effect';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { HolderCopies } from '../contract/service/holders.js';
import { Tasks, type ActedAfter, type SessionWork } from '../contract/service/work.js';
import { THREAD_WORK_ROWS, type WorkCopy } from '../contract/wire/threadWork.js';
import { pageRows } from '@runlith/paging';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { runGit } from '../../platform/git/ownGit.js';
import { SignedSession, WriterRegister, type SessionRow } from '../../platform/contract/service/writers.js';
import { SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { GateRefusal, walks } from '../../platform/contract/wire/refusal.js';
import { unmergedPaths } from '../../platform/git/unmerged.js';
import { BlockNames } from '../contract/service/acts.js';
import { Blocks } from '../contract/service/blocks.js';
import { GraphJournal } from '../contract/service/journal.js';
import { Tags } from '../contract/service/vocabulary.js';
import { History, Selection } from '../contract/service/reads.js';
import { CurrentGraph, GraphCall, RoutedGraphs, ServedGraphs } from '../contract/service/serving.js';
import { CallerAim } from '../../platform/contract/service/place.js';
import { GraphRecoveries } from '../contract/service/recovery.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { HISTORY_OPERATIONS as OPS, WRITERS } from '../contract/wire/operations/history.js';
import { WRITERS_WALK } from '../contract/wire/walks.js';
import { blockName } from '../contract/wire/references.js';
import { departedBlock, journalUnreadable } from '../contract/wire/journalPayloads.js';
import { journalBatches } from '../journal/eventLog.js';
import { journalSessions, writerSession } from '../journal/writers.js';
import { SessionNames } from '../contract/service/orientation.js';
import { wireBlock } from '../reading/rows.js';
import { served } from './served.js';
import { writableAt } from '../serving/writing.js';
import { captureTree } from '../tree/batch.js';
import { validateMerge } from '../tree/conflicts.js';

type In<K extends keyof typeof OPS> = (typeof OPS)[K]['input']['Type'];

const FIELD = '\x1f';
const RECORD = '\x1e';

const gitRefusal = (error: { readonly _tag: string; readonly message: string }): GateRefusal<'files'> =>
  new GateRefusal('files', `${error._tag}: ${error.message}`, ['read the report and retry']);

const WorkCursor = Schema.fromJsonString(
  Schema.Struct({ thread: Schema.String, at: Schema.Number, copy: Schema.String, lastId: Schema.Number }),
);

const workCursorOf = Effect.fnUntraced(function* (cursor: string, threadId: string) {
  const read = yield* Effect.mapError(
    Schema.decodeUnknownEffect(WorkCursor)(cursor),
    () =>
      new GateRefusal('bad-cursor', 'this cursor was not handed out by read_thread_work', ['read the first page again without a cursor']),
  );
  if (read.thread !== threadId) {
    return yield* new GateRefusal('cursor-stale', `this cursor continues the work of thread ${read.thread}, not ${threadId}`, [
      'read the first page of this thread again without a cursor',
    ]);
  }
  return read;
});

const afterIn = (cursor: typeof WorkCursor.Type, key: string): ActedAfter => ({
  at: cursor.at,
  lastId: key > cursor.copy ? Number.MAX_SAFE_INTEGER : key === cursor.copy ? cursor.lastId : 0,
});

export const HISTORY_PAIRS = {
  read_block_diff: pair(
    OPS.read_block_diff,
    body(OPS.read_block_diff, {
      execute: Effect.fnUntraced(function* (input: In<'read_block_diff'>) {
        const history = yield* History;
        const names = yield* BlockNames;
        const id = yield* names.idOfName(input.blockId);
        const own = yield* names.nameOf(id);
        const [row] = yield* (yield* Selection).records([id]);
        if (!row) {
          return yield* new GateRefusal('not-found', `block ${input.blockId} does not exist`, [
            'a diff is read of a block that exists, trashed or live',
          ]);
        }
        const seen = input.since === undefined ? undefined : new Date(input.since);
        if (seen !== undefined && Number.isNaN(seen.getTime())) {
          return yield* new GateRefusal('bad-since', `"${input.since}" is not a timestamp`, ['pass the ISO time of the state you saw']);
        }
        const from = seen === undefined ? (input.from ?? 0) : yield* history.positionAt(id, seen);
        const to = input.to ?? (yield* (yield* GraphJournal).events({ limit: 1 }))[0]?.id ?? 0;
        const subtree = yield* history.marks({ projectId: row.projectId, scopeId: id, from, to });
        return {
          status: 'ok' as const,
          diff: yield* history.blockDiff({ blockId: id, from, to }),
          marks: subtree.marks.filter((mark) => mark.blockName !== own),
          blocks: subtree.blocks.map(wireBlock),
        };
      }),
    }),
  ),

  read_journal: pair(
    OPS.read_journal,
    body(OPS.read_journal, {
      execute: Effect.fnUntraced(function* (input: In<'read_journal'>) {
        const call = yield* yield* GraphCall;
        const identities = input.tags === undefined ? null : (yield* (yield* Tags).of(call.project.id)).identities;
        const entries = yield* (yield* GraphJournal).events({
          projectId: call.project.id,
          scopeId: call.lens.scope,
          tags: input.tags === undefined || identities === null ? undefined : input.tags.map((word) => identities.keyOf(word) ?? word),
          sessions: input.sessions === undefined ? undefined : [...input.sessions],
          ops: input.ops === undefined ? undefined : [...input.ops],
          beforeId: input.before,
          sinceId: input.since,
          limit: input.limit,
        });
        const batches = journalBatches(entries);
        const oldest = entries.at(-1);
        const rows = yield* (yield* Selection).records([...new Set(batches.map((item) => item.blockId))]);
        const named = new Map(rows.map((row) => [row.id, blockName(row.uuid)] as const));
        const firstEntries = new Map(entries.map((entry) => [entry.id, entry]));
        const namedBatches = yield* Effect.forEach(batches, (item) =>
          Effect.gen(function* () {
            const entry = firstEntries.get(item.firstEventId)!;
            const moved = yield* Effect.mapError(Effect.fromResult(departedBlock(entry)), journalUnreadable);
            const { blockId, ...batch } = item;
            return {
              ...batch,
              blockName: named.get(blockId) ?? '',
              moved,
              firstTs: item.firstTs.toISOString(),
              lastTs: item.lastTs.toISOString(),
            };
          }),
        );
        const writers = yield* (yield* WriterRegister).named(
          batches.map((item) => item.sessionId).filter((id): id is number => id !== null),
        );
        return {
          status: 'ok' as const,
          batches: namedBatches,
          blocks: rows.map(wireBlock),
          sessions: yield* journalSessions(yield* SessionNames, call.project.id, writers),
          nextBefore: input.limit !== undefined && entries.length === input.limit && oldest ? oldest.id : null,
        };
      }),
    }),
  ),

  read_journal_vocabulary: pair(
    OPS.read_journal_vocabulary,
    body(OPS.read_journal_vocabulary, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const vocabulary = yield* (yield* GraphJournal).vocabulary({ projectId: call.project.id, scopeId: call.lens.scope });
        return { status: 'ok' as const, ...vocabulary };
      }),
    }),
  ),

  read_block_log: pair(
    OPS.read_block_log,
    body(OPS.read_block_log, {
      execute: Effect.fnUntraced(function* (input: In<'read_block_log'>) {
        const graph = yield* served;
        const row = yield* (yield* Blocks).rawBlockById(yield* (yield* BlockNames).idOfName(input.blockId));
        if (row.path === null) {
          return yield* new GateRefusal('not-projected', `block ${input.blockId} has no file in the tree yet`, [
            'write to it once — the write-through lands its file',
          ]);
        }
        const out = yield* Effect.mapError(
          runGit(graph.git, 'log', [
            '-C',
            graph.layout.treeRoot,
            'log',
            '--follow',
            `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s${RECORD}`,
            '--',
            row.path,
          ]),
          gitRefusal,
        );
        const log = out
          .split(RECORD)
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
          .map((entry) => {
            const [sha, author, date, message] = entry.split(FIELD);
            return { sha: sha ?? '', author: author ?? '', date: date ?? '', message: message ?? '' };
          });
        return { status: 'ok' as const, log };
      }),
    }),
  ),

  read_graph_recovery: pair(
    OPS.read_graph_recovery,
    body(OPS.read_graph_recovery, {
      execute: Effect.fnUntraced(function* (input) {
        const { project } = yield* yield* CurrentProject;
        const aim = yield* CallerAim;
        return {
          status: 'ok' as const,
          recovery: yield* (yield* GraphRecoveries).read({ projectId: project.id, cwd: aim?.cwd, branch: input.branch ?? aim?.branch }),
        };
      }),
    }),
  ),

  resolve_graph_conflict: pair(
    OPS.resolve_graph_conflict,
    body(OPS.resolve_graph_conflict, {
      execute: Effect.fnUntraced(function* (input) {
        const { project } = yield* yield* CurrentProject;
        const callerAim = yield* CallerAim;
        const aim = { projectId: project.id, cwd: callerAim?.cwd, branch: input.branch ?? callerAim?.branch };
        const current = yield* CurrentGraph;
        yield* writableAt(current);
        const recoveries = yield* GraphRecoveries;
        const recovery = yield* recoveries.read(aim);
        if (recovery !== null || current === null || current.layout.mode === 'team') {
          const result = yield* recoveries.finish(aim);
          const target = yield* (yield* ServedGraphs).resolve(aim);
          yield* admitted(OPS.resolve_graph_conflict)(target.settled(true));
          return {
            status: 'ok' as const,
            ...result,
            graphCopy: { projectId: target.projectId, checkout: target.checkout, tree: target.layout.treeRoot },
          };
        }
        const graph = yield* served;
        if (graph.shadow === null) {
          return yield* new GateRefusal('team-tree', 'this tree has no graph merge to conclude', ['read the checkout status']);
        }
        const open = yield* Effect.mapError(unmergedPaths(graph.git, graph.layout.treeRoot), gitRefusal);
        if (open.length === 0 && !(yield* Effect.mapError(graph.shadow.mergeInProgress(graph.layout.treeRoot), gitRefusal))) {
          return yield* new GateRefusal('no-merge', 'no merge stands open in this tree', ['nothing to resolve — the tree is calm']);
        }
        const capture = yield* captureTree(graph.layout.treeRoot, open, () => false).pipe(
          Effect.mapError((failure) => new GateRefusal('files', failure.message, ['resolve the graph files, then resolve again'])),
        );
        yield* validateMerge(graph.git, graph.layout.treeRoot, graph.layout.treeRoot, open, capture).pipe(
          Effect.mapError((failure) => (failure instanceof GateRefusal ? failure : gitRefusal(failure))),
        );
        const commit = yield* Effect.mapError(graph.shadow.concludeMerge(graph.layout.treeRoot), gitRefusal);
        yield* admitted(OPS.resolve_graph_conflict)(graph.settled(true));
        return { status: 'ok' as const, commit, resolved: open };
      }),
    }),
  ),

  read_session: pair(
    OPS.read_session,
    body(OPS.read_session, {
      execute: Effect.fnUntraced(function* (input) {
        const row = yield* (yield* WriterRegister).byId(input.id);
        if (row === undefined) {
          return yield* new GateRefusal('not-found', `writer session ${input.id} does not exist`, [
            'list_sessions — read the writers of the project',
          ]);
        }
        return { status: 'ok' as const, session: writerSession(row) };
      }),
    }),
  ),

  read_thread_work: pair(
    OPS.read_thread_work,
    body(OPS.read_thread_work, {
      execute: Effect.fnUntraced(function* (input: In<'read_thread_work'>) {
        const call = yield* yield* GraphCall;
        const aims = yield* (yield* HolderCopies).of(input.threadId, call.project.id);
        if (aims === null) {
          return yield* new GateRefusal('not-found', `${input.threadId} is no thread of project ${call.project.name}`, [
            'read the work of a thread in the project that holds it',
          ]);
        }
        const after = input.cursor === undefined ? undefined : yield* workCursorOf(input.cursor, input.threadId);
        const rows = input.limit ?? THREAD_WORK_ROWS;
        const pool = yield* RoutedGraphs;
        if (pool === null) {
          return yield* new GateRefusal(
            'copies-unreadable',
            'this call reaches no graph pool, so no copy the thread works in can be read',
            ['read it through a running server'],
          );
        }
        const projects = yield* Projects;
        const from = { harness: NATIVE_HARNESS, key: input.threadId };
        const copies: { readonly copy: WorkCopy; readonly key: string; readonly work: SessionWork }[] = [];
        const unread: { readonly projectId: number; readonly checkout: string; readonly reason: string }[] = [];
        const seen = new Set<string>();
        const opened = yield* Effect.forEach(aims, (aim) => Effect.result(Effect.tap(pool.hold(aim), (served) => served.fresh())), {
          concurrency: 'unbounded',
        });
        for (const [at, aim] of aims.entries()) {
          const open = opened[at]!;
          if (Result.isFailure(open)) {
            unread.push({ projectId: aim.projectId, checkout: aim.cwd ?? '', reason: `${open.failure.code}: ${open.failure.reason}` });
            continue;
          }
          const served = open.success;
          const key = `${served.projectId}\u0000${served.checkout}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const project = yield* projects.byId(served.projectId);
          const branches = yield* Effect.result(
            served.checkout === project.rootPath ? Effect.succeed([]) : pool.branches(served.projectId),
          );
          if (Result.isFailure(branches)) {
            unread.push({
              projectId: served.projectId,
              checkout: served.checkout,
              reason: `${branches.failure.code}: ${branches.failure.reason}`,
            });
            continue;
          }
          const standing = branches.success.find((one) => one.worktree === served.checkout);
          const work = yield* Effect.provide(
            Effect.flatMap(Tasks, (tasks) =>
              tasks.workOf({
                projectId: served.projectId,
                from,
                after: after === undefined ? undefined : afterIn(after, key),
                rows: rows + 1,
              }),
            ),
            served.context,
          );
          copies.push({
            copy: {
              projectId: served.projectId,
              project: project.name,
              branch: standing === undefined || standing.canonical ? null : standing.branch,
            },
            key,
            work,
          });
        }
        const acted = copies
          .flatMap((one, copy) => one.work.did.map((row) => ({ row, copy, key: one.key })))
          .sort((a, b) => b.row.at - a.row.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || b.row.lastId - a.row.lastId);
        const page = acted.slice(0, rows);
        const last = page.at(-1);
        return {
          status: 'ok' as const,
          copies: copies.map((one) => one.copy),
          unread,
          works: copies.flatMap((one, copy) => one.work.held.map((held) => ({ copy, ...held }))),
          did: page.map(({ row, copy }) => ({
            copy,
            name: row.name,
            title: row.title,
            tags: row.tags,
            status: row.status,
            acts: row.acts,
            last: row.last,
            at: new Date(row.at).toISOString(),
            commit: row.commit,
            commitUnread: row.commitUnread,
            trashed: row.trashed,
          })),
          total: copies.reduce((sum, one) => sum + one.work.total, 0),
          next:
            acted.length > rows && last !== undefined
              ? JSON.stringify({ thread: input.threadId, at: last.row.at, copy: last.key, lastId: last.row.lastId })
              : null,
        };
      }, Effect.scoped),
    }),
  ),

  list_sessions: pair(
    OPS.list_sessions,
    body(OPS.list_sessions, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* GraphCall;
        const journal = yield* GraphJournal;
        const cut = yield* walks.page({
          walk: WRITERS_WALK,
          selection: { projectId: call.project.id, checkout: (yield* CurrentGraph)?.checkout ?? null },
          cursor: input.cursor,
          asked: pageRows(input.limit, WRITERS, ceilingOf(WRITERS)),
          keyOf: (row: SessionRow): readonly [number] => [row.id],
          read: (after, limit) => journal.writersIn({ projectId: call.project.id, before: after?.[0], limit }),
        });
        return { status: 'ok' as const, sessions: cut.rows.map(writerSession), shown: cut.shown, total: cut.total, next: cut.next };
      }),
    }),
  ),
};
