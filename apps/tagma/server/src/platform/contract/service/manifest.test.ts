import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Schema } from 'effect';
import { ContributionPoint } from './contribution.js';
import { arms, operation } from '../wire/operation.js';
import { ASKS_NEVER } from '../wire/conditions.js';
import { OperationId } from '../wire/ids.js';
import { mergeOperations, OperationGroupConflict } from '../wire/manifest.js';
import { body, OperationPairInvalid, pair } from './body.js';
import {
  type Manifest,
  ManifestBodiesUnmatched,
  ManifestConflict,
  RefusalsUnphrased,
  bodiesOf,
  checkManifests,
  manifest,
  manifests,
  operationsOf,
  refusalWordsOf,
} from './manifest.js';
import { route } from './route.js';

const readValue = operation('read_value', {
  approval: ASKS_NEVER,
  meaning: 'Read a value',
  input: Schema.Struct({ value: Schema.Number }),
  answer: arms({ ok: { value: Schema.Number } }),
  refusals: [],
  effect: 'read',
  subject: 'none',
  place: 'machine',
  identity: 'none',
  waits: [],
  lifetimes: [],
  doors: { http: true },
  tool: undefined,
  callers: 'any',
  confirmation: () => ({ summary: 'Read' }),
  confirmLabel: 'Read',
  presentation: { running: 'Reading', done: 'Read' },
  subjects: () => [],
});
const implementation = body(readValue, { execute: ({ value }) => Effect.succeed({ status: 'ok', value }) });
const readPair = pair(readValue, implementation);

describe('manifest registration', () => {
  const declaring =
    (...declarations: (typeof readValue)[]) =>
    async () => ({ declarations: Object.fromEntries(declarations.map((declaration, index) => [String(index), declaration])) });

  const defectOf = <A>(effect: Effect.Effect<A>) =>
    Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : null));

  it.effect('rejects an operation id declared twice, within one owner or across owners, once the declarations load', () =>
    Effect.gen(function* () {
      expect(yield* defectOf(operationsOf([{ id: 'one', operations: declaring(readValue, readValue) }]))).toBeInstanceOf(ManifestConflict);
      expect(
        yield* defectOf(
          operationsOf([
            { id: 'one', operations: declaring(readValue) },
            { id: 'two', operations: declaring(readValue) },
          ]),
        ),
      ).toBeInstanceOf(ManifestConflict);
    }),
  );

  it.effect('refuses overlapping groups before one declaration can replace another', () =>
    Effect.gen(function* () {
      const module: Manifest = {
        id: 'owner',
        operations: async () => ({ declarations: mergeOperations({ read_value: readValue }, { read_value: readValue }) }),
      };
      const failure = yield* defectOf(operationsOf([module]));
      expect(failure).toBeInstanceOf(OperationGroupConflict);
      expect(failure).toMatchObject({ id: 'read_value' });
    }),
  );

  it('rejects duplicate owner-contribution ids after their list types are erased', () => {
    const modules: Manifest[] = [
      manifest({ id: 'one', capabilities: [{ id: 'tools', description: 'd', sections: [] }] }),
      manifest({ id: 'two', capabilities: [{ id: 'tools', description: 'd', sections: [] }] }),
    ];
    expect(() => manifests(...modules)).toThrow(ManifestConflict);
  });

  it("collects a point's entries with their owners, and rejects one point-and-id contributed by two owners", () => {
    const shelves = new ContributionPoint<{ readonly id: string; readonly size: number }>('shelves');
    const lamps = new ContributionPoint<{ readonly id: string }>('lamps');
    const modules: Manifest[] = [
      manifest({ id: 'one', contributions: [...shelves.of({ id: 'oak', size: 2 }), ...lamps.of({ id: 'oak' })] }),
      manifest({ id: 'two', contributions: shelves.of({ id: 'pine', size: 3 }) }),
    ];
    expect(shelves.collect(manifests(...modules))).toEqual([
      { owner: 'one', entry: { id: 'oak', size: 2 } },
      { owner: 'two', entry: { id: 'pine', size: 3 } },
    ]);
    expect(new ContributionPoint<{ readonly id: string }>('shelves').collect(modules)).toEqual([]);
    expect(() => manifests(...modules, manifest({ id: 'three', contributions: shelves.of({ id: 'oak', size: 1 }) }))).toThrow(
      ManifestConflict,
    );
  });

  it('refuses, naming both owners, one route path declared by two modules or overlapping a path the door serves itself', () => {
    const answering = (path: `/${string}`) => route({ path, handler: () => () => Effect.die('never answered') });
    const door = [
      { path: '/api/', prefix: true },
      { path: '/health', prefix: false },
    ];
    const owners = (modules: readonly Manifest[]) => {
      try {
        checkManifests(modules, door);
        return null;
      } catch (refused) {
        return refused instanceof ManifestConflict ? [refused.collection, refused.id, ...refused.owners] : refused;
      }
    };
    expect(
      owners([
        { id: 'one', routes: [answering('/back')] },
        { id: 'two', routes: [answering('/back')] },
      ]),
    ).toEqual(['routes', '/back', 'one', 'two']);
    expect(owners([{ id: 'one', routes: [answering('/api/back')] }])).toEqual(['routes', '/api/back', 'door', 'one']);
    expect(owners([{ id: 'one', routes: [answering('/health')] }])).toEqual(['routes', '/health', 'door', 'one']);
    expect(owners([{ id: 'one', routes: [answering('/healthy'), answering('/apis')] }])).toBeNull();
    expect(owners([{ id: 'one', routes: [answering('/Back/')] }])).toMatchObject({ _tag: 'RouteInexact', path: '/Back/' });
  });

  it('rejects a repeated module even when it contributes no operations', () => {
    const modules: Manifest[] = [manifest({ id: 'one' }), manifest({ id: 'one' })];
    expect(() => manifests(...modules)).toThrow(ManifestConflict);
  });

  it.effect('gives each declared refusal code the words of its one owner, and refuses a code nobody phrases or two modules phrase', () =>
    Effect.gen(function* () {
      const phrasing = (id: string, refusals: Readonly<Record<string, string>>): Manifest => ({
        id,
        operations: async () => ({
          declarations: { [`${id}_read`]: { ...readValue, id: OperationId.make(`${id}_read`), refusals: ['value-stale'] } },
          refusals,
        }),
      });
      const loaded = (...modules: Manifest[]) => operationsOf(modules);
      expect(refusalWordsOf(yield* loaded(phrasing('one', { 'value-stale': 'Value changed meanwhile' })), {})).toEqual({
        'value-stale': 'Value changed meanwhile',
      });
      expect(refusalWordsOf(yield* loaded(phrasing('one', {})), { 'value-stale': 'Changed meanwhile' })).toEqual({
        'value-stale': 'Changed meanwhile',
      });
      const unphrased = yield* loaded(phrasing('one', {}));
      expect(() => refusalWordsOf(unphrased, {})).toThrow(RefusalsUnphrased);
      const twice = yield* loaded(phrasing('one', { 'value-stale': 'Stale' }), phrasing('two', { 'value-stale': 'Old' }));
      expect(() => refusalWordsOf(twice, {})).toThrow(ManifestConflict);
    }),
  );

  const bodiesDefect = (module: Manifest) => defectOf(Effect.flatMap(operationsOf([module]), ([declared]) => bodiesOf(declared!)));

  it.effect('refuses a body prepared for a different declaration instance', () =>
    Effect.gen(function* () {
      expect(() => pair({ ...readValue }, implementation)).toThrow(OperationPairInvalid);
      const changed: Manifest = {
        id: 'changed',
        operations: declaring(readValue),
        bodies: async () => [{ ...readPair, declaration: { ...readValue } }],
      };
      expect(yield* bodiesDefect(changed)).toBeInstanceOf(OperationPairInvalid);
    }),
  );

  it.effect('refuses loaded bodies that leave a declaration unbodied or bring one undeclared', () =>
    Effect.gen(function* () {
      expect(yield* bodiesDefect({ id: 'unbodied', operations: declaring(readValue), bodies: async () => [] })).toBeInstanceOf(
        ManifestBodiesUnmatched,
      );
      expect(yield* bodiesDefect({ id: 'undeclared', bodies: async () => [readPair] })).toBeInstanceOf(ManifestBodiesUnmatched);
      const matched = operationsOf([{ id: 'matched', operations: declaring(readValue), bodies: async () => [readPair] }]);
      expect(yield* Effect.flatMap(matched, ([declared]) => bodiesOf(declared!))).toEqual([readPair]);
    }),
  );
});

describe('answer decoding', () => {
  const decode = Schema.decodeUnknownSync(readValue.answer);

  it('preserves an unknown answer arm and its fields for an older reader', () => {
    expect(decode({ status: 'deferred', receipt: 'receipt-1', details: { queued: true } })).toEqual({
      status: 'deferred',
      receipt: 'receipt-1',
      details: { queued: true },
    });
  });

  it('does not let a malformed known arm take the unknown-arm road', () => {
    expect(() => decode({ status: 'ok', value: 'wrong-type' })).toThrow();
    expect(() => decode({ status: 'ok' })).toThrow();
    expect(decode({ status: 'ok', value: 4 })).toEqual({ status: 'ok', value: 4 });
  });
});
