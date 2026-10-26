export type Facts = {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly zombie: boolean;
  readonly start: number;
  readonly name: string;
};

export type Row = Facts & { readonly marks: readonly string[] };

export interface Processes {
  readonly facts: (pid: number) => Facts | undefined;
  readonly rows: (scope: 'all' | readonly number[]) => Row[];
  readonly clock: () => number;
  readonly born: (since: number) => Row[];
  readonly children: (pid: number) => number[];
  readonly cwds: (pids: readonly number[]) => ReadonlyMap<number, string>;
  readonly command: (pid: number) => string | undefined;
  readonly cpu: (pid: number) => number | undefined;
  readonly reaped: () => number | undefined;
}

export const MARK = 'RUNLITH_TEST_RUN';

export const marksIn = (value: string | undefined): readonly string[] => (value === undefined || value === '' ? [] : value.split(':'));

let opened: Processes | undefined;

export const openProcesses = async (): Promise<Processes> => {
  if (opened !== undefined) return opened;
  const bun = typeof Bun !== 'undefined';
  opened =
    process.platform === 'darwin' && bun
      ? (await import('./processes/darwin.ts')).darwin()
      : process.platform === 'linux'
        ? await (await import('./processes/linux.ts')).linux(bun)
        : (await import('./processes/ps.ts')).ps();
  return opened;
};
