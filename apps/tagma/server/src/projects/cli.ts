import type { Command } from 'effect/cli';
import type { ProjectsCli } from './cli/verb.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const projectsVerbs = <Row, Removed, const Policy extends ReadonlyArray<Command.Command.Any>>(
  binding: () => Promise<ProjectsCli<Row, Removed, Policy>>,
): Readonly<{ project: VerbSource }> => ({
  project: async () => {
    const [{ projects }, port] = await Promise.all([import('./cli/verb.js'), binding()]);
    return { project: projects(port) };
  },
});
