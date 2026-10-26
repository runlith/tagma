import { expect, test } from 'bun:test';
import { loadVerbs } from '../../cli/verbs.js';
import { MODULES as DECLARED } from '@tagma/server/composition/modules';
import type { Manifest } from '../../platform/contract/service/manifest.js';
import { MODULES as DEVELOPER_MODULES } from '../developer/modules.js';
import { VERB_MODULES as DEVELOPER_VERBS } from '../developer/verbs.js';
import { MODULES as RELEASE_MODULES } from '../release/modules.js';
import { VERB_MODULES as RELEASE_VERBS } from '../release/verbs.js';
import type { VerbModule } from './binding.js';
import { bindingsOf, TAGMA_VERBS } from './verbs.js';

const MODULES: readonly Manifest[] = DECLARED;

const declaring = (modules: readonly Manifest[]) =>
  modules.flatMap((module) => (module.verbs === undefined ? [] : [[module.id, module.verbs] as const]));

test('the CLI verb table holds the verbs each manifest declares, in module order, for the developer and the release build', () => {
  const table = (verbs: readonly VerbModule[]) => verbs.map((module) => [module.id, module.verbs] as const);
  expect(table(DEVELOPER_VERBS)).toEqual(declaring(DEVELOPER_MODULES));
  expect(table(RELEASE_VERBS)).toEqual(declaring(RELEASE_MODULES));
  expect(Object.keys(TAGMA_VERBS)).toEqual([
    'serve',
    'db',
    ...Object.keys(Object.assign({}, ...MODULES.map((module) => module.verbs?.(...(bindingsOf(module.id) as never[])) ?? {}))),
  ]);
});

const verbs = await loadVerbs(TAGMA_VERBS);
const byName = new Map(verbs.map((command) => [command.name, command]));
const subcommandsOf = (name: string) => byName.get(name)?.subcommands.flatMap((group) => group.commands.map((command) => command.name));

test('every registered verb is declared and describes itself', () => {
  expect(verbs.map((command) => command.name)).toEqual(Object.keys(TAGMA_VERBS));
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

test('every module that declares verbs has the composition bindings its verbs take', () => {
  const unbound = MODULES.filter((module) => module.verbs !== undefined && bindingsOf(module.id).length === 0).map((module) => module.id);
  expect(unbound).toEqual([]);
});
