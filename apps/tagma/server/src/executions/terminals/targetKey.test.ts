import { describe, expect, test } from 'bun:test';
import { Result, Schema } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { EnvironmentId } from '../../workspace/contract/wire/environments.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { TargetIdentity, type TargetRoot } from '../contract/wire/targets.js';
import { targetKeyOf } from './subjectPolicy.js';

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const STRINGS = [
  'a',
  'b',
  'A',
  '0',
  '1',
  '00',
  'a/b',
  'a:b',
  'a,b',
  'a"b',
  'a\\b',
  '","',
  '"]',
  '["a","b"]',
  '[null]',
  'null',
  'true',
  '","cwd":"',
  'caf\u00e9',
  'cafe\u0301',
  'Stra\u00dfe',
  'STRASSE',
  'owner with spaces',
  'x'.repeat(300),
  '-',
  '_',
  '~',
  '.',
  '..',
  '/',
  'terminal:1:abc',
];
const INTS = [0, 1, 2, 7, 255, 65535, 2147483647, 9007199254740991];

const witness = (provider: string, format: string, token: string): TargetIdentity['environmentWitness'] => ({
  provider,
  format,
  token,
});

const root = (rootId: string, locationRevision: number, over: Partial<TargetRoot> = {}): TargetRoot => ({
  rootId: RootId.make(rootId),
  locationRevision: LocationRevision.make(locationRevision),
  witness: witness('provider', 'format', 'token'),
  ...over,
});

const identity = (over: Partial<TargetIdentity> = {}): TargetIdentity => ({
  owner: Principal.make('owner-1'),
  projectId: 1,
  actor: Principal.make('actor-1'),
  environmentId: EnvironmentId.make('environment-1'),
  namespaceId: NamespaceId.make('namespace-1'),
  environmentWitness: witness('environment-provider', 'environment-format', 'environment-token'),
  witness: witness('resource-provider', 'resource-format', 'resource-token'),
  cwd: '/work/checkout',
  roots: [root('root-1', 0)],
  ...over,
});

const decoded = (key: string): readonly unknown[] =>
  JSON.parse(Buffer.from(String(key), 'base64url').toString('utf8')) as readonly unknown[];

describe('targetKey injectivity', () => {
  test('one identity always encodes one key', () => {
    expect(String(targetKeyOf(identity()))).toBe(String(targetKeyOf(identity())));
  });

  test('root lookup order is not identity: permutations share the key', () => {
    const first = identity({ roots: [root('root-1', 0), root('root-2', 3)] });
    const second = identity({ roots: [root('root-2', 3), root('root-1', 0)] });
    expect(String(targetKeyOf(first))).toBe(String(targetKeyOf(second)));
    const tuples = decoded(String(targetKeyOf(first)))[8] as ReadonlyArray<readonly unknown[]>;
    expect(tuples.map((entry) => entry[0])).toEqual([...tuples.map((entry) => entry[0])].sort());
  });

  test('root multiplicity is identity: a duplicated root is another tuple', () => {
    const single = identity({ roots: [root('root-1', 0)] });
    const doubled = identity({ roots: [root('root-1', 0), root('root-1', 0)] });
    expect(String(targetKeyOf(single))).not.toBe(String(targetKeyOf(doubled)));
  });

  test('300 generated pairs differing in one field never share a key', () => {
    const random = mulberry32(0x74a9e7);
    const pick = <A>(pool: ReadonlyArray<A>): A => pool[Math.floor(random() * pool.length)] as A;
    const mutate = (base: TargetIdentity): TargetIdentity => {
      const field = Math.floor(random() * 9);
      switch (field) {
        case 0:
          return { ...base, owner: Principal.make(pick(STRINGS)) };
        case 1:
          return { ...base, projectId: pick(INTS) };
        case 2:
          return { ...base, actor: Principal.make(pick(STRINGS)) };
        case 3:
          return { ...base, environmentId: EnvironmentId.make(pick(STRINGS)) };
        case 4:
          return { ...base, namespaceId: NamespaceId.make(pick(STRINGS)) };
        case 5:
          return { ...base, environmentWitness: witness(pick(STRINGS), pick(STRINGS), pick(STRINGS)) };
        case 6:
          return { ...base, witness: witness(pick(STRINGS), pick(STRINGS), pick(STRINGS)) };
        case 7:
          return { ...base, cwd: pick(STRINGS) };
        default: {
          const count = Math.floor(random() * 4);
          const roots: TargetRoot[] = [];
          for (let index = 0; index < count; index += 1) {
            roots.push(root(pick(STRINGS), pick(INTS), { witness: witness(pick(STRINGS), pick(STRINGS), pick(STRINGS)) }));
          }
          return { ...base, roots };
        }
      }
    };
    for (let pair = 0; pair < 300; pair += 1) {
      const first = identity();
      const second = mutate(identity());
      if (JSON.stringify(first) === JSON.stringify(second)) continue;
      expect(String(targetKeyOf(first)), `pair ${pair}: ${JSON.stringify(first)} vs ${JSON.stringify(second)}`).not.toBe(
        String(targetKeyOf(second)),
      );
    }
  });

  test('a value holding JSON structural characters cannot forge a neighbouring field', () => {
    const forged = identity({ owner: Principal.make('K","L'), cwd: '/c' });
    const plain = identity({ owner: Principal.make('K'), cwd: '/c' });
    const left = decoded(String(targetKeyOf(forged)));
    const right = decoded(String(targetKeyOf(plain)));
    expect(String(targetKeyOf(forged))).not.toBe(String(targetKeyOf(plain)));
    expect(left[0]).toBe('K","L');
    expect(right[0]).toBe('K');
    expect(left.slice(1)).toEqual(right.slice(1));
  });

  test('a value shaped like another field never crosses positions', () => {
    const arrayShaped = identity({ cwd: '["root-1",0]', roots: [] });
    const structured = identity({ cwd: '/c', roots: [root('["root-1",0]', 0)] });
    expect(String(targetKeyOf(arrayShaped))).not.toBe(String(targetKeyOf(structured)));
    expect(decoded(String(targetKeyOf(arrayShaped)))[7]).toBe('["root-1",0]');
  });

  test('two adjacent fields cannot be re-cut by a value carrying a separator', () => {
    const pushed = identity({ environmentId: EnvironmentId.make('x:y'), namespaceId: NamespaceId.make('z') });
    const held = identity({ environmentId: EnvironmentId.make('x'), namespaceId: NamespaceId.make('y:z') });
    expect(String(targetKeyOf(pushed))).not.toBe(String(targetKeyOf(held)));
    const quoteCut = identity({ environmentId: EnvironmentId.make('x","y'), namespaceId: NamespaceId.make('z') });
    const quoteHeld = identity({ environmentId: EnvironmentId.make('x'), namespaceId: NamespaceId.make('y","z') });
    expect(String(targetKeyOf(quoteCut))).not.toBe(String(targetKeyOf(quoteHeld)));
    expect(decoded(String(targetKeyOf(pushed))).slice(3, 5)).toEqual(['x:y', 'z']);
    expect(decoded(String(targetKeyOf(held))).slice(3, 5)).toEqual(['x', 'y:z']);
  });

  test('no unicode spelling and no case folding merges two targets', () => {
    expect(String(targetKeyOf(identity({ cwd: 'caf\u00e9' })))).not.toBe(String(targetKeyOf(identity({ cwd: 'cafe\u0301' }))));
    expect(String(targetKeyOf(identity({ owner: Principal.make('Owner-1') })))).not.toBe(
      String(targetKeyOf(identity({ owner: Principal.make('owner-1') }))),
    );
    expect(String(targetKeyOf(identity({ cwd: '/Work/Checkout' })))).not.toBe(String(targetKeyOf(identity({ cwd: '/work/checkout' }))));
    expect(String(targetKeyOf(identity({ owner: Principal.make('Straße') })))).not.toBe(
      String(targetKeyOf(identity({ owner: Principal.make('STRASSE') }))),
    );
  });

  test('witness order is identity on both witnesses', () => {
    const swapped = identity({
      environmentWitness: witness('format', 'provider', 'token'),
      witness: witness('resource-provider', 'resource-format', 'resource-token'),
    });
    const straight = identity({
      environmentWitness: witness('provider', 'format', 'token'),
      witness: witness('resource-provider', 'resource-format', 'resource-token'),
    });
    expect(String(targetKeyOf(swapped))).not.toBe(String(targetKeyOf(straight)));
    const exchanged = identity({
      environmentWitness: witness('resource-provider', 'resource-format', 'resource-token'),
      witness: witness('provider', 'format', 'token'),
    });
    const left = decoded(String(targetKeyOf(straight)));
    const right = decoded(String(targetKeyOf(exchanged)));
    expect(String(targetKeyOf(straight))).not.toBe(String(targetKeyOf(exchanged)));
    expect([left[5], left[6]]).toEqual([right[6], right[5]]);
  });

  test('numbers never merge with the strings that spell them', () => {
    expect(String(targetKeyOf(identity({ projectId: 0 })))).not.toBe(String(targetKeyOf(identity({ projectId: 1 }))));
    expect(String(targetKeyOf(identity({ roots: [root('root-1', 0)] })))).not.toBe(
      String(targetKeyOf(identity({ roots: [root('root-1', 1)] }))),
    );
  });

  test('an identity with an absent field is refused before encoding', () => {
    const decode = Schema.decodeUnknownResult(TargetIdentity);
    expect(Result.isFailure(decode({ ...identity(), cwd: undefined }))).toBe(true);
    expect(Result.isFailure(decode({ ...identity(), cwd: null }))).toBe(true);
    expect(Result.isFailure(decode({ ...identity(), cwd: '' }))).toBe(true);
    expect(Result.isSuccess(decode(identity()))).toBe(true);
  });

  test('the key decodes to the tuple the kernel compares', () => {
    const key = String(targetKeyOf(identity()));
    const tuple = decoded(key);
    expect(tuple.slice(0, 5)).toEqual(['owner-1', 1, 'actor-1', 'environment-1', 'namespace-1']);
    expect(tuple[5]).toEqual(['environment-provider', 'environment-format', 'environment-token']);
    expect(tuple[6]).toEqual(['resource-provider', 'resource-format', 'resource-token']);
    expect(tuple[7]).toBe('/work/checkout');
    expect(tuple[8]).toEqual([['root-1', 0, 'provider', 'format', 'token']]);
  });
});
