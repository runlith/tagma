import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Context } from 'effect';
import type { MachineStore } from '../../platform/contract/service/store.js';
import { kindOfPreparedEntry, preparedBase, sweepClaim, sweepInstance } from './subject.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

const storeAt = (path: string): StoreShape => ({ path }) as StoreShape;

describe('sweepInstance', () => {
  it('deletes a subdirectory whose lock it could acquire', () => {
    expect(sweepInstance('locked', false)).toBe(true);
    expect(sweepInstance('locked', true)).toBe(true);
  });
  it('keeps a subdirectory a live predecessor holds', () => {
    expect(sweepInstance('held', false)).toBe(false);
    expect(sweepInstance('held', true)).toBe(false);
  });
  it('deletes an empty subdirectory without a lock file and keeps a nonempty one', () => {
    expect(sweepInstance('missing', true)).toBe(true);
    expect(sweepInstance('missing', false)).toBe(false);
  });
});

describe('sweepClaim', () => {
  it('deletes a claim no live process holds', () => {
    expect(sweepClaim('locked')).toBe(true);
  });
  it('keeps a claim a live claimant holds or has not locked yet', () => {
    expect(sweepClaim('held')).toBe(false);
    expect(sweepClaim('missing')).toBe(false);
  });
});

describe('kindOfPreparedEntry', () => {
  it('routes published instances, in-progress claims and foreign entries', () => {
    expect(kindOfPreparedEntry('instance-123e4567-e89b-12d3-a456-426614174000')).toBe('instance');
    expect(kindOfPreparedEntry('claim-123e4567-e89b-12d3-a456-426614174000')).toBe('claim');
    expect(kindOfPreparedEntry('other')).toBe('foreign');
    expect(kindOfPreparedEntry('tagma-prepared-abc.index')).toBe('foreign');
  });
});

describe('preparedBase', () => {
  it('routes a file store beside its database', () => {
    expect(preparedBase(storeAt(join('/data', 'tagma.sqlite')))).toBe(join('/data', 'change-record', 'prepared'));
  });
  it('routes an in-memory store under the system temp directory, never checkout-relative', () => {
    const base = preparedBase(storeAt(':memory:'));
    expect(base.startsWith(tmpdir())).toBe(true);
    expect(base).toBe(join(tmpdir(), 'tagma-change-record', 'prepared'));
  });
});
