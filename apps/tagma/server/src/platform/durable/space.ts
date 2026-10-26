import { spawnSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Words } from '../contract/wire/refusal.js';

export class SpaceShort extends Error {
  constructor(
    readonly needed: number,
    readonly free: number,
  ) {
    super(`needs ${needed} bytes; ${free} bytes are free`);
  }
}

export const standingAt = (path: string): string => (existsSync(path) ? path : standingAt(dirname(path)));

export const freeBytes = (path: string): number => {
  const disk = statfsSync(standingAt(path));
  return Number(disk.bavail) * Number(disk.bsize);
};

export const treeBytes = (path: string): number => {
  const measured = spawnSync('/usr/bin/du', ['-sk', path], { encoding: 'utf8' });
  const kilobytes = Number(measured.stdout.split('\t')[0]);
  if (measured.status !== 0 || !Number.isFinite(kilobytes))
    throw new Error(`the size of ${path} could not be measured: ${measured.stderr.trim()}`);
  return kilobytes * 1024;
};

export const requireFree = (path: string, needed: number): void => {
  const free = freeBytes(path);
  if (free < needed) throw new SpaceShort(needed, free);
};

export const gigabytes = (bytes: number): string => `${Math.max(0.1, Math.ceil(bytes / 1e8) / 10).toFixed(1)} GB`;

export const dataSpaceWords = (needed: number): Words => ({
  text: `Not enough free space: Tagma needs ${gigabytes(needed)} to keep a copy of your data while it updates. Free some space, then try again.`,
});
