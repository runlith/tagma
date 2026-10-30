import type { Command } from 'effect/cli';
import type { ProjectsCli } from './cli/verb.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const projectsVerbs = <Row, Removed, const Policy extends ReadonlyArray<Command.Command.Any>, Group, Left>(
  binding: () => Promise<ProjectsCli<Row, Removed, Policy, Group, Left>>,
): Readonly<{ project: VerbSource; group: VerbSource }> => ({
  project: async () => {
    const [{ projects }, port] = await Promise.all([import('./cli/verb.js'), binding()]);
    return { project: projects(port) };
  },
  group: async () => {
    const [{ grouping }, port] = await Promise.all([import('./cli/verb.js'), binding()]);
    return { group: grouping(port) };
  },
});
