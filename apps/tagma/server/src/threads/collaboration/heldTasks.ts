import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { AGENT_CHILD_UPDATE_SIGNAL_TYPE } from '@runlith/agent/contracts';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { NATIVE_HARNESS, type SessionRef } from '../../platform/contract/wire/session.js';
import { ServedGraphs, type CopyAim, type HeldTask, type ServedGraph } from '../../graph/contract/service/serving.js';
import { Tasks } from '../../graph/contract/service/work.js';
import { HeldTasks } from '../contract/service/heldTasks.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { WorkPlaces } from '../contract/service/working.js';
import type { ThreadPlacement } from '../contract/service/placement.js';
import type { GraphOrigin } from '../contract/wire/target.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadEvent, ThreadEventRecipient } from '../events/happened.js';
import type { ThreadSummary } from '../list/summary.js';
import type { EventLines } from '../subscriptions/delivery.js';

export const HELD_TASKS_SUBSCRIBER = 'held tasks';

export type HeldTasksInput = {
  readonly threads: ThreadLookup['Service'];
  readonly places: WorkPlaces['Service'];
  readonly placement: ThreadPlacement['Service'];
  readonly lines: EventLines;
};

type Thread = { readonly id: string; readonly projectId: number };

const sessionOf = (thread: ThreadSummary): SessionRef => ({ harness: NATIVE_HARNESS, key: thread.id });

const named = (tasks: readonly HeldTask[]) => tasks.map((task) => `- ${task.name} ${task.title}`).join('\n');

export const handedLine = (child: ThreadSummary, held: readonly HeldTask[], filed: readonly HeldTask[]): string =>
  [
    ...(held.length === 0
      ? []
      : [
          `${child.name ?? child.id} stopped working and held ${held.length === 1 ? 'a task' : `${held.length} tasks`}; ${held.length === 1 ? 'it is' : 'they are'} yours now — finish, close or release each, or hand it on with claim by the session that takes it:`,
          named(held),
        ]),
    ...(filed.length === 0
      ? []
      : [
          `${child.name ?? child.id} filed ${filed.length === 1 ? 'a task' : `${filed.length} tasks`} that nobody has taken:`,
          named(filed),
        ]),
  ].join('\n');

export const makeHeldTasks = Effect.fnUntraced(function* ({ threads, places, placement, lines }: HeldTasksInput) {
  const graphs = yield* ServedGraphs;
  const projects = yield* Projects;

  const aimsOf = Effect.fn('HeldTasks.aims')(function* (thread: Thread, rows: readonly GraphOrigin[]) {
    const home = (yield* projects.byId(thread.projectId)).rootPath;
    const aims = new Map<string, CopyAim>();
    for (const place of [
      { projectId: thread.projectId, root: home },
      ...(yield* placement.rootsOf(thread.id)).map((root) => ({ projectId: thread.projectId, root: root.path })),
      ...rows,
    ]) {
      const key = `${place.projectId}\u0000${place.root}`;
      if (!aims.has(key)) aims.set(key, { projectId: place.projectId, cwd: place.root });
    }
    return [...aims.values()];
  });

  const copiesOf = Effect.fn('HeldTasks.copiesOf')(function* (aims: readonly CopyAim[]) {
    const copies: ServedGraph[] = [];
    const seen = new Set<string>();
    const held = yield* Effect.forEach(aims, (aim) => Effect.tap(graphs.hold(aim), (served) => served.fresh()), {
      concurrency: 'unbounded',
    });
    for (const served of held) {
      const key = `${served.projectId}\u0000${served.checkout}`;
      if (seen.has(key)) continue;
      seen.add(key);
      copies.push(served);
    }
    return copies;
  });

  const tell = (parent: ThreadSummary, child: ThreadSummary, key: string, held: readonly HeldTask[], filed: readonly HeldTask[]) =>
    held.length === 0 && filed.length === 0
      ? Effect.void
      : lines({
          subscriberId: parent.id,
          about: child.id,
          type: AGENT_CHILD_UPDATE_SIGNAL_TYPE,
          key: `tasks:${parent.id}:${key}`,
          text: handedLine(child, held, filed),
          notice: {
            kind: 'child-update',
            child: { threadId: child.id, projectId: child.projectId, name: child.name },
            event: 'tasks',
            forOperator: false,
            cost: { kind: 'unknown', tokens: null },
          },
          wakes: false,
          replaces: [],
        });

  const living = Effect.fnUntraced(function* (thread: ThreadSummary, leaving: ReadonlySet<string>) {
    const parentId = thread.parentThreadId;
    if (parentId === null || leaving.has(parentId)) return null;
    const parent = yield* threads.summary(parentId);
    return parent === undefined || parent.archivedAt !== null ? null : parent;
  });

  const stopped = Effect.fn('HeldTasks.stopped')(function* (child: ThreadSummary, key: string, leaving: ReadonlySet<string>) {
    const parent = yield* living(child, leaving);
    const pending = yield* places.taking(child.id);
    const copies = yield* copiesOf(yield* aimsOf(child, pending.copies));
    if (parent !== null) {
      const held: HeldTask[] = [];
      const filed: HeldTask[] = [];
      for (const copy of copies) {
        const standing = yield* Effect.provide(
          Effect.flatMap(Tasks, (tasks) => tasks.holdings({ projectId: copy.projectId, from: sessionOf(child) })),
          copy.context,
        );
        held.push(...standing.held);
        filed.push(...standing.filed);
      }
      yield* tell(parent, child, key, held, filed);
    }
    for (const copy of copies) {
      yield* Effect.provide(
        Effect.flatMap(Tasks, (tasks) =>
          tasks.handOver({ projectId: copy.projectId, from: sessionOf(child), to: parent === null ? null : sessionOf(parent) }),
        ),
        copy.context,
      );
    }
    yield* places.handed(child.id, pending);
  }, Effect.scoped);

  const handle = (event: ThreadEvent) =>
    event.kind === 'rested'
      ? stopped(event.thread, event.run.runId, new Set()).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })))
      : Effect.void;

  const recipient: ThreadEventRecipient = {
    name: HELD_TASKS_SUBSCRIBER,
    takes: ['rested'],
    follows: (thread) => Effect.succeed(thread.parentThreadId !== null && thread.archivedAt === null),
    handle,
  };

  const left = Effect.fn('HeldTasks.left')(function* (threadIds: readonly string[]) {
    const leaving = new Set(threadIds);
    const act = randomUUID();
    for (const thread of yield* threads.summaries(threadIds).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })))) {
      yield* stopped(thread, `left:${act}`, leaving).pipe(
        Effect.mapError((cause) =>
          cause instanceof GateRefusal
            ? new GateRefusal(
                'thread-tasks-unreadable',
                `The tasks thread ${thread.id} holds could not be handed on before it ends: ${cause.reason}`,
                [...cause.unblock, 'end the thread again once that graph copy answers'],
              )
            : new ThreadCallBroke({ cause }),
        ),
      );
    }
  });

  const worked = Effect.fn('HeldTasks.worked')(function* (thread: Thread) {
    return yield* aimsOf(thread, yield* places.worked(thread.id));
  });

  return { recipient, service: HeldTasks.of({ left }), worked };
});
