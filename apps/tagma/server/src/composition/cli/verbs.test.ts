import { expect, test } from 'bun:test';
import { loadVerbs } from '../../cli/verbs.js';
import type { Manifest } from '../../platform/contract/service/manifest.js';
import type { Build } from '../build.js';
import { DEVELOPER } from '../developer/build.js';
import { MODULES as DEVELOPER_DECLARED } from '../developer/modules.js';
import { RELEASE } from '../release/build.js';
import { MODULES as RELEASE_DECLARED } from '../release/modules.js';
import { bindingsOf, verbsOf } from './verbs.js';

const DEVELOPER_MODULES: readonly Manifest[] = DEVELOPER_DECLARED;
const RELEASE_MODULES: readonly Manifest[] = RELEASE_DECLARED;

const declaring = (modules: readonly Manifest[]) =>
  modules.flatMap((module) => (module.verbs === undefined ? [] : [[module.id, module.verbs] as const]));

const server = async () => ({});

test('the CLI verb table holds the verbs each manifest declares, in module order, for the developer and the release build', () => {
  const table = (build: Build) => build.verbs.map((module) => [module.id, module.verbs] as const);
  expect(table(DEVELOPER)).toEqual(declaring(DEVELOPER_MODULES));
  expect(table(RELEASE)).toEqual(declaring(RELEASE_MODULES));
  const bindings = bindingsOf(DEVELOPER);
  expect(Object.keys(verbsOf(DEVELOPER, server))).toEqual([
    'serve',
    'db',
    ...Object.keys(
      Object.assign({}, ...DEVELOPER_MODULES.map((module) => module.verbs?.(...((bindings[module.id] ?? []) as never[])) ?? {})),
    ),
  ]);
});

const verbs = await loadVerbs(verbsOf(DEVELOPER, server));
const byName = new Map(verbs.map((command) => [command.name, command]));
const subcommandsOf = (name: string) => byName.get(name)?.subcommands.flatMap((group) => group.commands.map((command) => command.name));

test('every registered verb is declared and describes itself', () => {
  expect(verbs.map((command) => command.name)).toEqual(Object.keys(verbsOf(DEVELOPER, server)));
  for (const command of verbs) expect(command.description, command.name).toBeDefined();
});

test('continue remains an operator verb beside the socket-only operation id', () => {
  expect(byName.has('continue')).toBe(true);
});

test('operation-less command, sandbox, thread and host mechanics remain declared', () => {
  expect(subcommandsOf('command')).toEqual(['bytes']);
  expect(subcommandsOf('sandbox')).toEqual(['list', 'run']);
  expect(subcommandsOf('threads')).toEqual(['new', 'types', 'set']);
  expect(byName.has('thread')).toBe(true);
});

test('every module that declares verbs has the composition bindings its verbs take, in both builds', () => {
  for (const [build, modules] of [
    [DEVELOPER, DEVELOPER_MODULES],
    [RELEASE, RELEASE_MODULES],
  ] as const) {
    const bindings = bindingsOf(build);
    const unbound = modules
      .filter((module) => module.verbs !== undefined && (bindings[module.id] ?? []).length === 0)
      .map((module) => module.id);
    expect(unbound).toEqual([]);
  }
});
