import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { builtinModeRegistry, ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { ASKS_IN_REVIEW } from '../platform/contract/wire/conditions.js';
import { Context, Effect } from 'effect';
import type { Operation } from '../platform/contract/wire/operation.js';
import type { OperationId } from '../platform/contract/wire/ids.js';
import { CallAuthority } from '../platform/contract/service/authority.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { judged } from './approval.js';
import { operationRegistry } from './registry.js';

const modes = builtinModeRegistry();

const catalog = OperationCatalog.of({
  registry: operationRegistry<OperationId>({
    ['update_block' as OperationId]: {
      subjects: () => [],
      approval: ASKS_IN_REVIEW,
      confirmation: () => ({ summary: 's' }),
      mutates: true,
    } as unknown as Operation,
  } as Record<OperationId, Operation>),
  modes,
  bound: () => undefined,
  checks: () => null,
  presentation: () => undefined,
  refusals: {},
  subjects: () => undefined,
  subjectCalls: () => Context.empty(),
});

it.effect('a mode added by one registration refuses on the operation door by its own code', () =>
  Effect.gen(function* () {
    yield* modes.register('test', {
      id: 'plan',
      label: 'Plan',
      description: 'Proposes; changes nothing.',
      icon: 'eye',
      strictness: 1.5,
      refuses: (act) => (act.mutating ? { code: 'plan-only', reason: 'Plan changes nothing.' } : null),
    });
    const code = yield* judged('update_block', {}, undefined, {
      actor: { kind: 'thread', threadId: 't', projectId: 1, principalId: 'o', session: { harness: 'tagma', key: 't' } },
      files: null,
    }).pipe(
      Effect.provideService(OperationCatalog, catalog),
      Effect.provideService(CallAuthority, 'plan'),
      Effect.provideService(ApprovalModes, modes),
      Effect.match({ onFailure: (refusal) => refusal.code, onSuccess: () => 'performed' }),
    );
    expect(code).toBe('plan-only');
  }),
);
