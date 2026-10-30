import { Command } from 'effect/cli';
import type { OperationsCli } from './contract/service/operations.js';

type Load = () => Promise<Record<string, unknown>>;
export type VerbSources = Readonly<Record<string, Load>>;

export type Preface = (argv: readonly string[]) => string | undefined;

export const cliVerbs = <Id extends string>(binding: () => Promise<OperationsCli<Id>>): VerbSources => {
  return {
    op: async () => {
      const [{ operations }, cli] = await Promise.all([import('./verbs/op.js'), binding()]);
      return operations(cli);
    },
    'mcp-serve': async () => {
      const [{ mcpServe }, cli] = await Promise.all([import('./verbs/mcpServe.js'), binding()]);
      return { mcpServe: mcpServe(cli) };
    },
  };
};

const declared = (module: Record<string, unknown>, verb: string): Command.Command.Any | undefined =>
  Object.values(module).find((value): value is Command.Command.Any => Command.isCommand(value) && value.name === verb);

const prefaceOf = (module: Record<string, unknown>): Preface | undefined =>
  typeof module.preface === 'function' ? (module.preface as Preface) : undefined;

export const verbNamed = async (
  verb: string,
  contributions: VerbSources,
): Promise<{ readonly command: Command.Command.Any | undefined; readonly preface: Preface | undefined } | undefined> => {
  const load = contributions[verb];
  if (load === undefined) return undefined;
  const module = await load();
  return { command: declared(module, verb), preface: prefaceOf(module) };
};

export const loadVerbs = async (contributions: VerbSources): Promise<readonly Command.Command.Any[]> => {
  const loaded = new Map<Load, Record<string, unknown>>();
  for (const load of new Set(Object.values(contributions))) loaded.set(load, await load());
  return Object.keys(contributions).flatMap((verb) => {
    const command = declared(loaded.get(contributions[verb] as Load) as Record<string, unknown>, verb);
    return command === undefined ? [] : [command];
  });
};
