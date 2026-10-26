import type { ProcessProgram } from '../UsageReader';

export type Placed = {
  readonly pid: number;
  readonly parent: number;
  readonly responsible: number;
  readonly executable: string | undefined;
  readonly invoked: string | undefined;
  readonly name: string;
};

const BUNDLE = '.app/';

export const bundleOf = (executable: string | undefined): ProcessProgram | undefined => {
  if (executable === undefined) return undefined;
  const at = executable.indexOf(BUNDLE);
  if (at < 0) return undefined;
  const key = executable.slice(0, at + BUNDLE.length - 1);
  return { key, name: key.slice(key.lastIndexOf('/') + 1, -'.app'.length) };
};

export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

const ownProgram = (placed: Placed): ProcessProgram =>
  placed.executable === undefined
    ? { key: `name:${placed.name}`, name: placed.name }
    : {
        key: `exe:${placed.executable}`,
        name: placed.name,
        where: placed.executable.includes('/') ? placed.executable.slice(0, placed.executable.lastIndexOf('/')) || '/' : undefined,
      };

export const programsOf = (listed: ReadonlyArray<Placed>): ReadonlyMap<number, ProcessProgram> => {
  const byPid = new Map(listed.map((one) => [one.pid, one]));
  const bundled = new Map<number, ProcessProgram | null>();
  const bundleAbove = (start: number): ProcessProgram | undefined => {
    const path: number[] = [];
    let found: ProcessProgram | null = null;
    for (let pid = start, hops = 0; pid > 1 && hops < 256; hops += 1) {
      const known = bundled.get(pid);
      if (known !== undefined) {
        found = known;
        break;
      }
      const one = byPid.get(pid);
      if (one === undefined) break;
      path.push(pid);
      const own = bundleOf(one.executable) ?? (one.responsible === pid ? undefined : bundleOf(byPid.get(one.responsible)?.executable));
      if (own !== undefined) {
        found = own;
        break;
      }
      pid = one.parent;
    }
    for (const pid of path) bundled.set(pid, found);
    return found ?? undefined;
  };
  const programs = new Map<number, ProcessProgram>();
  for (const one of listed) {
    const responsible = one.responsible === one.pid ? undefined : byPid.get(one.responsible);
    programs.set(one.pid, bundleAbove(one.pid) ?? ownProgram(responsible ?? one));
  }
  return programs;
};
