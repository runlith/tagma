import { describe, expect, it } from 'bun:test';
import type { Pack } from '../rule';
import type { Implementation } from './reading';
import { implementationOf, register, RuleNotReady } from './registry';

const reading = (extra: Partial<Implementation<unknown>> = {}) =>
  ({ lists: () => [], selects: () => false, read: () => ({ violations: [], unjudged: [] }), ...extra }) as Implementation<unknown>;

const pack = (id: string, rules: readonly Record<string, unknown>[]) => ({ id, uses: {}, rules }) as unknown as Pack;

const registered = (one: Pack, readings: Record<string, Implementation<unknown>>) => () => register(one, readings as never);

describe('registering a pack', () => {
  it('refuses a rule without a reading, a reading without a rule, slices on one side only, and a rule another pack registered', () => {
    expect(registered(pack('a', [{ id: 'x' }]), {})).toThrow();
    expect(registered(pack('a', [{ id: 'x' }]), { x: reading(), y: reading() })).toThrow();
    expect(registered(pack('a', [{ id: 'x', sliced: true }]), { x: reading() })).toThrow();
    expect(registered(pack('a', [{ id: 'x' }]), { x: reading({ slices: {} as never }) })).toThrow();
    register(pack('a', [{ id: 'x' }]), { x: reading() } as never);
    expect(registered(pack('b', [{ id: 'x' }]), { x: reading() })).toThrow();
  });

  it('registers nothing of a pack it refuses, and answers RuleNotReady for a rule no loaded pack holds', () => {
    expect(registered(pack('c', [{ id: 'kept' }, { id: 'lost' }]), { kept: reading() })).toThrow();
    expect(() => implementationOf('kept')).toThrow(RuleNotReady);
  });
});
