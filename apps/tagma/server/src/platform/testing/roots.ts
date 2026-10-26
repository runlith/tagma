import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const PER_USER_TEMP = ['/private/var/folders', '/var/folders'];

const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

const resolved = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export const underPerUserTemp = (path: string): boolean =>
  process.platform === 'darwin' && PER_USER_TEMP.some((root) => within(path, root) || within(resolved(path), root));

const SHARED_TEMP = process.platform === 'darwin' ? '/tmp' : tmpdir();

export const fixtureHome = (): string => {
  const supplied = process.env['TMPDIR'];
  return supplied !== undefined && supplied !== '' && !underPerUserTemp(supplied) ? supplied : SHARED_TEMP;
};

export const fixtureRoot = (owner: string, name: string): string => join(fixtureHome(), owner, name);
