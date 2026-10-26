import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Schema } from 'effect';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { invocationAssembly } from './assembly.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { OperationChecks } from './contract/service/operationChecks.js';
import { ANSWER_ONLY } from './contract/service/performer.js';
import { operationRegistry } from './registry.js';
import { forProject } from './testing/call.js';
import { CallAuthority } from '../platform/contract/service/authority.js';
import { OperationId } from '../platform/contract/wire/ids.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../platform/contract/wire/conditions.js';
import type { Operation } from '../platform/contract/wire/operation.js';
import type { Caller } from '../platform/contract/wire/caller.js';

const read = OperationId.make('look');
const write = OperationId.make('change');
const declared = (approval: Operation['approval'], mutates: boolean): Operation => ({
  callers: 'any',
  tool: undefined,
  approval,
  meaning: 'Touch the selected subject.',
  params: Schema.Struct({}),
  refusals: [],
  confirmation: () => ({ summary: 'Touch the subject' }),
  confirmLabel: 'Touch',
  presentation: { running: 'Touching', done: 'Touched' },
  subjects: () => [],
  effect: mutates ? 'write' : 'read',
  subject: 'none',
  place: 'project',
  mutates: mutates ? true : undefined,
});
const catalog = OperationCatalog.of({
  registry: operationRegistry<OperationId>({ [read]: declared(ASKS_NEVER, false), [write]: declared(ASKS_IN_REVIEW, true) }),
  modes: builtinModeRegistry(),
  bound: () => ({ execute: () => Effect.succeed('done') }),
  checks: () => null,
  presentation: () => undefined,
  refusals: {},
  subjects: () => undefined,
  subjectCalls: () => Context.empty(),
});
const context = Context.make(OperationCatalog, catalog).pipe(
  Context.add(OperationChecks, {
    run: (_id, _actor, work) => work,
    afterEdit: () => Effect.void,
  }),
);
const caller: Caller = {
  actor: { kind: 'thread', threadId: 'thread', projectId: 1, principalId: 'owner', session: { harness: 'tagma', key: 'thread' } },
  files: null,
};

const outcome = (operation: OperationId, projectId: number, mode: 'trust' | 'review' | 'bypass') =>
  Effect.result(
    Effect.map(
      invocationAssembly.performer.performByIdIn(() => Effect.succeed(context))(
        operation,
        {},
        { caller, place: null, world: null },
        ANSWER_ONLY,
      ),
      (performed) => performed.value,
    ),
  ).pipe(forProject(Effect.succeed({ project: { id: projectId, name: String(projectId) } })), Effect.provideService(CallAuthority, mode));

it.effect('an act in another project of the machine gets the verdict it gets at home', () =>
  Effect.gen(function* () {
    for (const projectId of [1, 2]) {
      for (const mode of ['trust', 'review', 'bypass'] as const)
        expect(yield* outcome(read, projectId, mode)).toMatchObject({ _tag: 'Success', success: 'done' });
      for (const mode of ['trust', 'bypass'] as const)
        expect(yield* outcome(write, projectId, mode)).toMatchObject({ _tag: 'Success', success: 'done' });
      expect(yield* outcome(write, projectId, 'review')).toMatchObject({ _tag: 'Failure', failure: { code: 'no-approver' } });
    }
  }),
);
