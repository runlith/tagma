import { describe, expect, it } from 'bun:test';
import { Result } from 'effect';
import { coordinateOf, sameFormat, sameWitness, witnessOf, type Coordinate, type Stat } from './witness';

const stat = (over: Partial<Stat> = {}): Stat => ({
  type: 'Directory',
  inode: 1006478170,
  birthtime: 1788864273000,
  ...over,
});

const place = (over: Partial<Coordinate> = {}): Coordinate => ({
  type: 'Directory',
  device: 16777234,
  inode: 1006478170,
  ...over,
});

const token = (over: Partial<Stat> = {}): string => {
  const minted = witnessOf(stat(over));
  if (Result.isFailure(minted)) throw new Error(`no witness: ${minted.failure}`);
  return minted.success.token;
};

describe('filesystem identity witnesses', () => {
  it('separates objects that differ in any fact, and holds one object to one token', () => {
    expect(token()).toBe(token());
    expect(token({ birthtime: 1788864289000 })).not.toBe(token());
    expect(token({ inode: 1006517438 })).not.toBe(token());
    expect(token({ type: 'File' })).not.toBe(token());
  });

  it('identifies nothing where the filesystem supplied no inode, no device or no birthtime', () => {
    for (const missing of [{ inode: null }, { inode: 0 }, { inode: -1 }, { inode: 2 ** 53 }]) {
      expect(witnessOf(stat(missing))).toEqual(Result.fail('inode'));
      expect(coordinateOf(place(missing))).toEqual(Result.fail('coordinate'));
    }
    expect(coordinateOf(place({ device: 0.5 }))).toEqual(Result.fail('coordinate'));
    for (const missing of [{ birthtime: null }, { birthtime: 0 }, { birthtime: Number.NaN }, { birthtime: Infinity }]) {
      expect(witnessOf(stat(missing))).toEqual(Result.fail('birthtime'));
    }
  });

  it('reads a token only under the terms that minted it, and says when there are no shared terms', () => {
    const minted = witnessOf(stat());
    if (Result.isFailure(minted)) throw new Error('no witness');
    expect(sameWitness(minted.success, { ...minted.success })).toBe(true);
    expect(sameFormat(minted.success, { ...minted.success })).toBe(true);
    for (const foreign of [{ provider: 'other' }, { format: 'stat-coordinate' }]) {
      const other = { ...minted.success, ...foreign };
      expect(sameWitness(minted.success, other)).toBe(false);
      expect(sameFormat(minted.success, other)).toBe(false);
    }
    const moved = { ...minted.success, token: token({ inode: 1006517438 }) };
    expect(sameFormat(minted.success, moved)).toBe(true);
    expect(sameWitness(minted.success, moved)).toBe(false);
  });
});
