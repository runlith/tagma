import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { Context, Effect, Schema } from 'effect';
import type { Actor } from '../platform/contract/wire/actor.js';
import type { Operation } from '../platform/contract/wire/operation.js';
import type { OperationId } from '../platform/contract/wire/ids.js';
import { ASKS_IN_REVIEW } from '../platform/contract/wire/conditions.js';
import { CallAuthority } from '../platform/contract/service/authority.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { judged } from './approval.js';
import { ApprovalSeats } from './contract/service/approvalSeats.js';
import { operationRegistry } from './registry.js';
import { admitCallers } from './admission/callers.js';

const entry = {
  callers: 'any',
  tool: undefined,
  meaning: 'm',
  params: Schema.Struct({}),
  refusals: [],
  approval: ASKS_IN_REVIEW,
  confirmation: () => ({ summary: 's' }),
  confirmLabel: 'c',
  presentation: { running: 'r', done: 'd' },
  subjects: () => [],
  mutates: true,
} as unknown as Operation;

const catalog = OperationCatalog.of({
  registry: operationRegistry<OperationId>({ ['finish_block' as OperationId]: entry } as Record<OperationId, Operation>),
  modes: builtinModeRegistry(),
  bound: () => undefined,
  checks: () => null,
  presentation: () => undefined,
  refusals: {},
  subjects: () => undefined,
  subjectCalls: () => Context.empty(),
});

const thread: Actor = {
  kind: 'thread',
  threadId: 'thread-1',
  projectId: 1,
  principalId: 'owner-1',
  session: { harness: 'tagma', key: 'thread-1' },
};

const outcome = (actor: Actor, mode: AgentApprovalMode | null, seats?: typeof ApprovalSeats.Service) =>
  judged('finish_block', {}, undefined, { actor, files: null }).pipe(
    Effect.provideService(OperationCatalog, catalog),
    Effect.provideService(CallAuthority, mode),
    Effect.provideService(ApprovalSeats, seats ?? null),
    Effect.match({ onFailure: (refusal) => refusal.code, onSuccess: () => 'performed' }),
  );

it.effect('caller admission requires a proven thread for thread protocols, and an operator operation refuses a thread in every mode', () =>
  Effect.gen(function* () {
    const admitted = (callers: 'any' | 'thread' | 'operator', actor: Actor) =>
      admitCallers('act', callers, 'Act on the project.', { actor, files: null }).pipe(
        Effect.match({ onFailure: (refusal) => refusal.code, onSuccess: () => 'admitted' }),
      );
    expect(yield* admitted('thread', { kind: 'operator' })).toBe('thread-required');
    expect(yield* admitted('thread', { kind: 'session', session: { harness: 'claude-code', key: 'unproven' }, projectId: 1 })).toBe(
      'session-unproven',
    );
    expect(yield* admitted('thread', thread)).toBe('admitted');
    expect(yield* admitted('operator', thread)).toBe('operator-only');
    expect(yield* admitted('operator', { kind: 'operator' })).toBe('admitted');
  }),
);

it.effect('the judge asks a thread by its mode rung, and a door with nobody to ask refuses with no-approver', () =>
  Effect.gen(function* () {
    expect(yield* outcome(thread, 'bypass')).toBe('performed');
    expect(yield* outcome(thread, 'trust')).toBe('performed');
    expect(yield* outcome(thread, 'review')).toBe('no-approver');
    expect(yield* outcome({ kind: 'operator' }, null)).toBe('performed');
  }),
);

it.effect('a saved answer is spent once and the same act asks again after it', () =>
  Effect.gen(function* () {
    const given = new Set<string>();
    let standing = '';
    const seats: typeof ApprovalSeats.Service = {
      ask: (request) =>
        Effect.sync(() => {
          if (given.delete(request.key)) return { _tag: 'Given' } as const;
          standing = request.key;
          return { _tag: 'Waiting', questionId: 'question-1', waitedMs: 0 } as const;
        }),
    };
    expect(yield* outcome(thread, 'review', seats)).toBe('approval-pending');
    given.add(standing);
    expect(yield* outcome(thread, 'review', seats)).toBe('performed');
    expect(yield* outcome(thread, 'review', seats)).toBe('approval-pending');
  }),
);

it.effect('a question that lapsed refuses unanswered and a declined one refuses declined', () =>
  Effect.gen(function* () {
    const lapsed: typeof ApprovalSeats.Service = {
      ask: () => Effect.succeed({ _tag: 'Lapsed', questionId: 'q', askedOf: 'the operator', timeoutMs: 600_000 }),
    };
    const declined: typeof ApprovalSeats.Service = { ask: () => Effect.succeed({ _tag: 'Declined', by: 'the operator' }) };
    expect(yield* outcome(thread, 'review', lapsed)).toBe('unanswered');
    expect(yield* outcome(thread, 'review', declined)).toBe('declined');
  }),
);
