import type { ProcessProgram } from '../../UsageReader';

import { ownProgram, type ProgramProcess } from '../programs';

const BUNDLE = '.app/';

const bundleOf = (executable: string | undefined): ProcessProgram | undefined => {
  if (executable === undefined) return undefined;
  const at = executable.indexOf(BUNDLE);
  if (at < 0) return undefined;
  const key = executable.slice(0, at + BUNDLE.length - 1);
  return { key, name: key.slice(key.lastIndexOf('/') + 1, -'.app'.length) };
};

export const programsOf = (listed: ReadonlyArray<ProgramProcess>): ReadonlyMap<number, ProcessProgram> => {
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
      const own =
        bundleOf(one.executable) ??
        (one.responsible === undefined || one.responsible === pid ? undefined : bundleOf(byPid.get(one.responsible)?.executable));
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
    const responsible = one.responsible === undefined || one.responsible === one.pid ? undefined : byPid.get(one.responsible);
    programs.set(one.pid, bundleAbove(one.pid) ?? ownProgram(responsible ?? one));
  }
  return programs;
};
