import type { Module } from './graph.ts';

type MapAnswer = {
  readonly status: string;
  readonly map?: {
    readonly modules: readonly { readonly id: string; readonly territory: readonly string[] }[];
    readonly relations: readonly { readonly from: string; readonly to: string; readonly role?: 'testing' }[];
    readonly problems: readonly string[];
  };
};

const READ = ['op', 'read_inspections', JSON.stringify({ map: true, limit: 1 }), '--json'];

export const moduleMapAt = (root: string): readonly Module[] => {
  const unread = (reason: string): Error =>
    new Error(`check:change reads the module map from Tagma (tagma ${READ.join(' ')}) in ${root} and could not: ${reason}`);
  const run = () => Bun.spawnSync(['tagma', ...READ], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  let ran: ReturnType<typeof run>;
  try {
    ran = run();
  } catch (cause) {
    throw unread(cause instanceof Error ? cause.message : String(cause));
  }
  const said = `${ran.stdout.toString()}${ran.stderr.toString()}`.trim();
  if (ran.exitCode !== 0) throw unread(said);
  const answer = JSON.parse(ran.stdout.toString()) as MapAnswer;
  if (answer.status !== 'ok' || answer.map === undefined) throw unread(said);
  const { modules, relations, problems } = answer.map;
  if (problems.length > 0) throw unread(`the module cards do not hold together:\n${problems.join('\n')}`);
  const imports = new Map<string, string[]>();
  const tests = new Map<string, string[]>();
  for (const relation of relations) {
    const into = relation.role === 'testing' ? tests : imports;
    const held = into.get(relation.from);
    if (held === undefined) into.set(relation.from, [relation.to]);
    else held.push(relation.to);
  }
  return modules.map((module) => ({
    id: module.id,
    paths: module.territory.map((at) => at.replace(/\/$/, '')),
    imports: imports.get(module.id) ?? [],
    tests: tests.get(module.id) ?? [],
  }));
};
