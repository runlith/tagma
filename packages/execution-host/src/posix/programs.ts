import type { ProcessProgram } from '../UsageReader';

export type ProgramProcess = {
  readonly pid: number;
  readonly parent: number;
  readonly responsible: number | undefined;
  readonly executable: string | undefined;
  readonly invoked: string | undefined;
  readonly name: string;
};

export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

const COMMAND_CHARS = 240;

export const commandLine = (args: readonly string[]): string | undefined => {
  const joined = args.join(' ');
  return joined === '' ? undefined : joined.length > COMMAND_CHARS ? `${joined.slice(0, COMMAND_CHARS)}…` : joined;
};

export const ownProgram = (placed: ProgramProcess): ProcessProgram =>
  placed.executable === undefined
    ? { key: `name:${placed.name}`, name: placed.name }
    : {
        key: `exe:${placed.executable}`,
        name: placed.name,
        where: placed.executable.includes('/') ? placed.executable.slice(0, placed.executable.lastIndexOf('/')) || '/' : undefined,
      };

export const programsOf = (listed: readonly ProgramProcess[]): ReadonlyMap<number, ProcessProgram> =>
  new Map(listed.map((one) => [one.pid, ownProgram(one)]));
