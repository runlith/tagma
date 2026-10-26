import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { Context, Effect, Schema } from 'effect';
import { ConnectionError, SqlError } from 'effect/sql/SqlError';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { invocationAssembly } from './assembly.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { OperationChecks } from './contract/service/operationChecks.js';
import { ANSWER_ONLY } from './contract/service/performer.js';
import { operationRegistry } from './registry.js';
import { forProject } from './testing/call.js';
import { OperationId } from '../platform/contract/wire/ids.js';
import { ASKS_NEVER } from '../platform/contract/wire/conditions.js';
import type { Caller } from '../platform/contract/wire/caller.js';

const PROJECT = 7;
const read = OperationId.make('read_project_state');
const catalog = OperationCatalog.of({
  registry: operationRegistry<OperationId>({
    [read]: {
      callers: 'any',
      tool: undefined,
      approval: ASKS_NEVER,
      meaning: 'Read the project state.',
      params: Schema.Struct({}),
      refusals: [],
      confirmation: () => ({ summary: 'Read the project state' }),
      confirmLabel: 'Read',
      presentation: { running: 'Reading', done: 'Read' },
      subjects: () => [],
      effect: 'read',
      subject: 'none',
      place: 'project',
    },
  }),
  modes: builtinModeRegistry(),
  bound: () => ({ execute: () => Effect.fail(new SqlError({ reason: new ConnectionError({ cause: new Error('the store is down') }) })) }),
  checks: () => null,
  presentation: () => undefined,
  refusals: {},
  subjects: () => undefined,
  subjectCalls: () => Context.empty(),
});
const owners = Context.make(OperationCatalog, catalog).pipe(
  Context.add(OperationChecks, { run: (_id, _actor, work) => work, afterEdit: () => Effect.void }),
);
const operator: Caller = { actor: { kind: 'operator' }, files: null };

it.effect('a store failure that ends a call naming no thread is its defect, recorded in the project the call stands in', () =>
  Effect.gen(function* () {
    const recording = activityRecording();
    const exit = yield* Effect.exit(
      invocationAssembly.performer
        .performByIdIn(() => Effect.succeed(owners))(read, {}, { caller: operator, place: null, world: null }, ANSWER_ONLY)
        .pipe(forProject(Effect.succeed({ project: { id: PROJECT, name: 'demo' } })), Effect.provideService(ActivityLog, recording.log)),
    );
    expect(exit).toMatchObject({ _tag: 'Failure', cause: { reasons: [{ _tag: 'Die' }] } });
    expect(recording.activities().map((one) => ({ opened: one.opened, notes: one.notes }))).toMatchObject([
      {
        opened: {
          kind: 'fault',
          thread: null,
          project: PROJECT,
          actor: { kind: 'operator' },
          trigger: { kind: 'operation', refs: [read] },
        },
        notes: [{ type: 'defect', place: read }],
      },
    ]);
  }),
);
