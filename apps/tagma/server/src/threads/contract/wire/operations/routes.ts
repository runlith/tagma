import { Schema } from 'effect';
import { placeRole } from '../../../../platform/contract/wire/place.js';
import { type Raised } from '@runlith/agent/permissions';
import { SPAWN_REFUSALS } from '@runlith/agent/collaboration/refusals';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { threadTypesSchema } from '../birth.js';
import { threadCreateSchema, threadSeenSchema } from '../creation.js';
import { threadListRowSchema, threadListWindowSchema } from '../list.js';
import { threadWireSnapshotPayloadSchema } from '../snapshot.js';
import { TURN_OPERATIONS } from './turns.js';
import { MODE_WITHHELD, THREAD_ARCHIVED } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { HELD_ELSEWHERE } from '../../../../graph/contract/wire/operations/shared.js';

const surface = {
  doors: { http: 'perform' },
  tool: undefined,
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
  subjects: () => [],
} as const;

const read = { ...surface, graph: 'none', effect: 'read', identity: 'none' } as const;
const write = { ...surface, effect: 'write', identity: { key: 'call' } } as const;

export const BIRTH_REFUSALS = [
  'unknown-project',
  'project-required',
  'ambiguous-project',
  'not-found',
  'deleted',
  'scope-outside-project',
  'foreign-project',
  'title-empty',
  'title-required',
  'delegation-off',
  'task-required',
  'child-inherits',
  'parent-required',
  'unknown-type',
  'type-withheld',
  'harness-not-installed',
  'mode-unknown',
  'model-unavailable',
  'model-unserved',
  'provider-not-installed',
  'unknown-model',
  'no-provider',
  'no-model-connected',
  'account-signed-out',
  'host-unknown',
  'base-without-new',
  'name-without-new',
  'placement-refused',
  'placement-unreadable',
  'worktree-name-invalid',
  'worktree-name-taken',
  'worktree-unavailable',
  'worktree-unknown',
] as const;

const WORK_BIRTH_REFUSALS = [
  'work-with-task',
  'born-without-work',
  'no-holder',
  'claimed-elsewhere',
  'superseded',
  'no-status',
  'illegal-status',
  'illegal-transition',
] as const;

export const ROUTE_OPERATIONS = {
  start_graph_recovery: operation('start_graph_recovery', {
    approval: ASKS_IN_REVIEW,
    ...write,
    graph: 'none',
    callers: 'operator',
    meaning:
      'Assign the pending graph conflict to a recovery thread and open its first turn with both sides and the recovery directory. Repeated requests reuse that thread and its opening message.',
    input: Schema.Struct({ id: Schema.String, branch: Schema.String }),
    answer: arms({ assigned: { threadId: ThreadId } }),
    refusals: [...BIRTH_REFUSALS, ...TURN_OPERATIONS.start_turn.refusals, 'team-tree'],
    confirmation: () => ({ summary: 'Assign this graph conflict to an agent?' }),
    confirmLabel: 'Assign to agent',
    presentation: { running: 'Starting graph recovery', done: 'Assigned graph recovery' },
  }),
  create_thread: operation('create_thread', {
    approval: { ...ASKS_IN_REVIEW, when: [MODE_WITHHELD, THREAD_ARCHIVED, HELD_ELSEWHERE] },
    ...write,
    callers: 'any',
    external: true,
    meaning:
      'Open a thread without a first turn — a root thread of this project, or a child of another thread with its opening task. A root born on a block of work opens its first turn on it; work a holder can take, it first takes in its own name the way claim_block would, and a spec it starts on without taking.',
    input: threadCreateSchema,
    answer: arms({ loaded: { snapshot: threadWireSnapshotPayloadSchema.fields.snapshot } }),
    refusals: [...BIRTH_REFUSALS, ...SPAWN_REFUSALS, ...WORK_BIRTH_REFUSALS],
    subjects: () => [],
    raises: (_input, birth?: { readonly asked: readonly Raised[] }) => birth?.asked ?? [],
    confirmation: () => ({ summary: 'Open a thread?' }),
    confirmLabel: 'Open thread',
    presentation: { running: 'Opening a thread', done: 'Opened a thread' },
  }),
  list_thread_types: operation('list_thread_types', {
    approval: ASKS_NEVER,
    ...read,
    callers: 'any',
    meaning:
      'Read the agents a thread of this project may open as, and the agent files that could not be offered. `refresh` reads the login profile again and searches every agent CLI anew, so one installed since is found.',
    input: Schema.Struct({ refresh: Schema.optional(Schema.Boolean) }),
    answer: arms({ ok: threadTypesSchema.fields }),
    refusals: ['unknown-project', 'project-required'],
    confirmation: () => ({ summary: 'Read the thread types?' }),
    confirmLabel: 'Read types',
    presentation: { running: 'Reading the thread types', done: 'Read the thread types' },
  }),
  list_thread_window: operation('list_thread_window', {
    approval: ASKS_NEVER,
    ...read,
    callers: 'operator',
    meaning: "Read the window of this project's root threads the list opens on, with the rows of their live descendants.",
    input: Schema.Struct({ readerBefore: Schema.optional(Schema.String) }),
    answer: arms({ ok: threadListWindowSchema.fields }),
    refusals: ['unknown-project', 'project-required', 'selection-shape', 'bad-cursor', 'cursor-stale'],
    confirmation: () => ({ summary: 'Read the thread list window?' }),
    confirmLabel: 'Read list',
    presentation: { running: 'Reading the thread list', done: 'Read the thread list' },
  }),
  locate_thread: operation('locate_thread', {
    approval: ASKS_NEVER,
    ...read,
    callers: 'any',
    meaning: 'Read which project holds a thread.',
    input: Schema.Struct({ threadId: ThreadId.annotate(placeRole('mention')) }),
    answer: arms({ located: { projectId: Schema.Number } }),
    refusals: ['not-found'],
    confirmation: (input) => ({ summary: `Locate ${input.threadId}?` }),
    confirmLabel: 'Locate',
    presentation: { running: 'Locating a thread', done: 'Located a thread' },
  }),
  mark_thread_seen: operation('mark_thread_seen', {
    approval: ASKS_IN_REVIEW,
    ...write,
    graph: 'none',
    callers: 'operator',
    meaning: "Mark a thread's run as read by the operator, and answer the thread's row.",
    place: 'project',
    input: Schema.Struct({ threadId: ThreadId, ...threadSeenSchema.fields }),
    answer: arms({ seen: threadListRowSchema.fields }),
    refusals: ['not-found', 'unknown-project', 'project-required', 'foreign-project', 'thread-gone'],
    confirmation: (input) => ({ summary: `Mark ${input.threadId} seen?` }),
    confirmLabel: 'Mark seen',
    presentation: { running: 'Marking a thread seen', done: 'Marked a thread seen' },
  }),
  detach_thread: operation('detach_thread', {
    approval: ASKS_IN_REVIEW,
    ...write,
    graph: 'none',
    callers: 'operator',
    meaning:
      'Lift a spawned thread out of its parent with everything spawned under it, so it stands as a root of its own; or return a detached thread under the parent it left.',
    grammar:
      "A detached thread stands as any root does: the tasks its old team gave the lifted subtree are closed unanswered, queued ones included, and its delegation follows its own switch or the machine's. Nobody is woken: the thread and the parent it left each read a notice at their next step if a run is going, or at the next run something else opens. Detaching a thread already detached answers the same detachment again. An archived thread is brought back with what was put away with it, then detached or returned. `detached: false` puts it back under the thread it left, whatever depth that makes; the depth setting bounds only new spawns.",
    place: 'project',
    input: Schema.Struct({
      threadId: ThreadId,
      detached: Schema.optional(Schema.Boolean).annotate({
        description: 'true — lift it out to a root (the default); false — return it under the thread it was detached from.',
      }),
    }),
    answer: arms({
      detached: { threadId: Schema.String, from: Schema.String, members: Schema.Int },
      reattached: { threadId: Schema.String, under: Schema.String },
    }),
    refusals: [
      'not-found',
      'unknown-project',
      'project-required',
      'foreign-project',
      'thread-gone',
      'not-a-child',
      'not-detached',
      'parent-archived',
      'workflow-member',
      'name-taken',
    ],
    confirmation: (input) => ({
      summary: input.detached === false ? `Return ${input.threadId} under its parent?` : `Detach ${input.threadId} from its parent?`,
    }),
    confirmLabel: 'Detach',
    presentation: { running: 'Detaching a thread', done: 'Detached a thread' },
  }),
};

export type RouteOperationId = keyof typeof ROUTE_OPERATIONS;
