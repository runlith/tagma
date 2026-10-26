import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { TOOL_OUTPUT_MAX_BYTES } from '@runlith/agent/ToolOutputSpool';
import type { Caller } from '../platform/contract/wire/caller.js';
import type { Operation } from '../platform/contract/wire/operation.js';
import { operationRegistry } from './registry.js';
import { INVOCATION_OPERATIONS, type OperationsAnswer } from './contract/wire/operations.js';
import { OperationCatalog } from './contract/service/catalog.js';
import { READ_OPERATIONS_PAIR } from './readOperations.js';

const declared = (bridges: Partial<Operation> = {}): Operation =>
  ({
    approval: { asksFrom: 'never' },
    callers: 'any',
    tool: undefined,
    meaning: 'm',
    params: Schema.Struct({ name: Schema.String }),
    refusals: [],
    confirmation: () => ({ summary: 's' }),
    confirmLabel: 'c',
    presentation: { running: 'r', done: 'd' },
    subjects: () => [],
    ...bridges,
  }) as Operation;

const registryOf = (count: number) =>
  operationRegistry(
    Object.fromEntries([
      ['read_overview', declared()],
      ...Array.from({ length: count }, (_, at) => [`op_${String(at).padStart(3, '0')}`, declared()]),
    ]),
  );

const execute = (registry: ReturnType<typeof registryOf>, input: Record<string, unknown>) =>
  READ_OPERATIONS_PAIR.body
    .execute(input as never, undefined, {} as Caller)
    .pipe(Effect.provideService(OperationCatalog, { registry, bound: () => undefined, checks: () => null, voice: () => null } as never));

const read = (registry: ReturnType<typeof registryOf>, input: Record<string, unknown>) => Effect.result(execute(registry, input));

const answered = (registry: ReturnType<typeof registryOf>, input: Record<string, unknown>) =>
  Effect.map(Effect.orDie(execute(registry, input)), (answer) => answer as OperationsAnswer);

it.effect('an operation row states who may call it and what it asks, with its conditions', () =>
  Effect.gen(function* () {
    const held = { id: 'held', label: 'Held', asksFrom: 'trust', timeout: 'none' } as const;
    const walked = operationRegistry<string>({ read_overview: declared({ approval: { asksFrom: 'never', when: [held] } }) });
    const rows = (yield* answered(walked, {})).operations.rows;
    expect(rows[0]).toMatchObject({
      callers: 'any',
      approval: { asksFrom: 'never', timeoutMs: null, conditions: [{ id: 'held', asksFrom: 'trust' }] },
    });
  }),
);

it.effect('the declared answer preserves registry rows and pagination over the wire', () =>
  Effect.gen(function* () {
    const answer = yield* answered(registryOf(1), {});
    const encoded = yield* Schema.encodeUnknownEffect(INVOCATION_OPERATIONS.read_operations.answer)(answer);
    expect(encoded).toEqual(answer);
  }),
);

it.effect('walking the pages reads every entry once, under one contract', () =>
  Effect.gen(function* () {
    const registry = registryOf(40);
    const seen: string[] = [];
    let cursor: string | null = null;
    let contract: string | null = null;
    do {
      const page: OperationsAnswer = yield* answered(registry, { limit: 7, cursor: cursor ?? undefined });
      seen.push(...page.operations.rows.map((row) => row.id));
      contract ??= page.contract;
      expect(page.contract).toBe(contract);
      cursor = page.operations.next;
    } while (cursor !== null);
    expect(seen).toEqual([...registry.ids].sort());
  }),
);

it.effect('a page of heavy entries ends before the tool-output envelope, and the walk still reads every entry', () =>
  Effect.gen(function* () {
    const heavy = operationRegistry(
      Object.fromEntries(Array.from({ length: 9 }, (_, at) => [`heavy_${at}`, declared({ grammar: 'x'.repeat(20_000) })])),
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: OperationsAnswer = yield* answered(heavy, cursor === null ? {} : { cursor });
      expect(page.operations.rows.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_BYTES);
      seen.push(...page.operations.rows.map((row) => row.id));
      cursor = page.operations.next;
    } while (cursor !== null);
    expect(seen).toEqual([...heavy.ids].sort());
  }),
);

it.effect('ids narrow the rows to the operations named, and a name that is no operation is listed unknown', () =>
  Effect.gen(function* () {
    const answer = yield* answered(registryOf(3), { ids: ['read_overview', 'op_001', 'nothing'] });
    expect(answer.operations.rows.map((row) => row.id)).toEqual(['op_001', 'read_overview']);
    expect(answer.unknown).toEqual(['nothing']);
  }),
);

it.effect('a cursor minted under another registry is stale', () =>
  Effect.gen(function* () {
    const next = (yield* answered(registryOf(10), { limit: 2 })).operations.next;
    expect(next).not.toBeNull();
    const refused = yield* read(registryOf(11), { limit: 2, cursor: next });
    expect(refused._tag === 'Failure' && (refused.failure as { code: string }).code).toBe('cursor-stale');
  }),
);
