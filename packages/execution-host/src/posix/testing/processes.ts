import { Effect } from 'effect';

export type PidState = 'standing' | 'gone' | 'unreadable';

export const pidStanding = (pid: number): Effect.Effect<PidState> =>
  Effect.sync(() => {
    if (!Number.isInteger(pid) || pid <= 0) return 'unreadable';
    try {
      globalThis.process.kill(pid, 0);
      return 'standing';
    } catch (error) {
      const code = (error as { readonly code?: unknown }).code;
      return code === 'ESRCH' ? 'gone' : code === 'EPERM' ? 'standing' : 'unreadable';
    }
  });

export const groupStanding = (group: number): PidState => {
  if (!Number.isInteger(group) || group <= 0) return 'unreadable';
  try {
    globalThis.process.kill(-group, 0);
    return 'standing';
  } catch (error) {
    const code = (error as { readonly code?: unknown }).code;
    return code === 'ESRCH' ? 'gone' : code === 'EPERM' ? 'standing' : 'unreadable';
  }
};

export const killGroup = (group: number, signal: string): boolean => {
  if (!Number.isInteger(group) || group <= 0) return false;
  try {
    globalThis.process.kill(-group, signal as NodeJS.Signals);
    return true;
  } catch {
    return false;
  }
};

export const killStray = (pid: number, signal: string): Effect.Effect<boolean> =>
  Effect.sync(() => {
    try {
      globalThis.process.kill(pid, signal as NodeJS.Signals);
      return true;
    } catch {
      return false;
    }
  });
