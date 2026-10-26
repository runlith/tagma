import { constants, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

const O_EXLOCK = 0x20;

let held: number | undefined;

export function holdInstance(userData: string, elected: boolean): boolean {
  if (process.platform !== 'darwin') return elected;
  mkdirSync(userData, { recursive: true });
  try {
    held = openSync(join(userData, 'instance.lock'), constants.O_RDWR | constants.O_CREAT | constants.O_NONBLOCK | O_EXLOCK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EAGAIN') return false;
    throw error;
  }
}
