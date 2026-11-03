import type { PolicyCommands, ProjectsCli } from './cli/verb.js';

export const projectsVerbs = <Row, Removed, const Policy extends PolicyCommands, Group, Left>(
  binding: () => Promise<ProjectsCli<Row, Removed, Policy, Group, Left>>,
) => ({
  project: async () => {
    const [{ projects }, port] = await Promise.all([import('./cli/verb.js'), binding()]);
    return { project: projects(port) };
  },
  group: async () => {
    const [{ grouping }, port] = await Promise.all([import('./cli/verb.js'), binding()]);
    return { group: grouping(port) };
  },
});
