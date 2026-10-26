import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const isOutsideMachineTemp = (path: string): boolean => {
  try {
    const machine = realpathSync(tmpdir());
    const resolved = realpathSync(path);
    return resolved !== machine && !resolved.startsWith(`${machine}/`);
  } catch {
    return false;
  }
};

export const durableFixtureHome = (): string => {
  const supplied = process.env['TMPDIR'];
  return supplied !== undefined && isOutsideMachineTemp(supplied) ? supplied : join(homedir(), '.tagma-tests');
};
