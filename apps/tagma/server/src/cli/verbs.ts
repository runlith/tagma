import { Command } from 'effect/cli';
import type { Preface, VerbCommand, Verbs, VerbSource, VerbSources } from '../platform/cli/verb.js';
import type { OperationsCli } from './contract/service/operations.js';

export const cliVerbs = <Id extends string>(binding: () => Promise<OperationsCli<Id>>) => ({
  op: async () => {
    const [{ operations }, cli] = await Promise.all([import('./verbs/op.js'), binding()]);
    return operations(cli);
  },
  'mcp-serve': async () => {
    const [{ mcpServe }, cli] = await Promise.all([import('./verbs/mcpServe.js'), binding()]);
    return { mcpServe: mcpServe(cli) };
  },
});

const declared = <R>(module: Verbs<R>, verb: string): VerbCommand<R> | undefined =>
  Object.values(module).find((value): value is VerbCommand<R> => Command.isCommand(value) && value.name === verb);

const prefaceOf = <R>(module: Verbs<R>): Preface | undefined => {
  const preface = module.preface;
  return typeof preface === 'function' ? preface : undefined;
};

export const verbNamed = async <R>(
  verb: string,
  contributions: VerbSources<R>,
): Promise<{ readonly command: VerbCommand<R> | undefined; readonly preface: Preface | undefined } | undefined> => {
  const load = contributions[verb];
  if (load === undefined) return undefined;
  const module = await load();
  return { command: declared(module, verb), preface: prefaceOf(module) };
};

export const loadVerbs = async <R>(contributions: VerbSources<R>): Promise<readonly VerbCommand<R>[]> => {
  const loaded = new Map<VerbSource<R>, Verbs<R>>();
  for (const load of new Set(Object.values(contributions))) loaded.set(load, await load());
  return Object.entries(contributions).flatMap(([verb, load]) => {
    const module = loaded.get(load);
    const command = module === undefined ? undefined : declared(module, verb);
    return command === undefined ? [] : [command];
  });
};
