import { Result } from 'effect';
import type { IdentityWitness } from './namespace.js';

export type Coordinate = {
  readonly type: string;
  readonly device: number;
  readonly inode: number | null;
};

export type Stat = {
  readonly type: string;
  readonly inode: number | null;
  readonly birthtime: number | null;
};

export type WitnessUnusable = 'inode' | 'birthtime';

const PROVIDER = 'effect/FileSystem';
const FORMAT = 'stat-inode-birthtime';

const usableInode = (inode: number | null): inode is number => inode !== null && Number.isSafeInteger(inode) && inode > 0;

export const coordinateOf = (place: Coordinate): Result.Result<string, 'coordinate'> =>
  !usableInode(place.inode) || !Number.isSafeInteger(place.device)
    ? Result.fail('coordinate')
    : Result.succeed(JSON.stringify([place.type, place.device, place.inode]));

export const witnessOf = (stat: Stat): Result.Result<IdentityWitness, WitnessUnusable> => {
  if (!usableInode(stat.inode)) return Result.fail('inode');
  const born = stat.birthtime;
  if (born === null || !Number.isFinite(born) || born === 0) return Result.fail('birthtime');
  return Result.succeed({ provider: PROVIDER, format: FORMAT, token: JSON.stringify([stat.type, stat.inode, born]) });
};

export const sameFormat = (left: IdentityWitness, right: IdentityWitness): boolean =>
  left.provider === right.provider && left.format === right.format;

export const sameWitness = (left: IdentityWitness, right: IdentityWitness): boolean =>
  sameFormat(left, right) && left.token === right.token;

export const witnessTuple = (witness: IdentityWitness): readonly string[] => [witness.provider, witness.format, witness.token];
