import * as rules from '@runlith/tagma/rules';
import * as effect from '@runlith/tagma/rules/effect';
import { BUILTIN_IDS, type BuiltinId } from '@tagma/inspection/builtins';
import { Predicate } from 'effect';
import type { Descriptor } from '../../config/contract/wire/config.js';

export type Form =
  | { readonly kind: 'builtin'; readonly name: string; readonly door: string; readonly builtin: BuiltinId }
  | { readonly kind: 'program'; readonly name: string; readonly door: string }
  | { readonly kind: 'linter'; readonly name: string; readonly door: string; readonly tool: string };

const DOORS = [
  ['/rules', rules],
  ['/rules/effect', effect],
] as const;

const PROGRAM = 'defineInspection';

const builtins: ReadonlySet<string> = new Set(BUILTIN_IDS);

const isBuiltin = (id: unknown): id is BuiltinId => typeof id === 'string' && builtins.has(id);

const toolOf = (described: unknown): string | undefined => {
  if (!Predicate.isObject(described) || !Predicate.isObject(described.linter)) return undefined;
  return typeof described.linter.tool === 'string' ? described.linter.tool : undefined;
};

const formOfMember = (name: string, door: string, make: (options: object) => unknown): Form | undefined => {
  const made = make({});
  if (!Predicate.isObject(made)) return undefined;
  if (isBuiltin(made.builtin)) return { kind: 'builtin', name, door, builtin: made.builtin };
  const tool = Predicate.isFunction(made.rule) ? toolOf((made.rule as (id: string) => unknown)('rule')) : toolOf(made);
  return tool === undefined ? undefined : { kind: 'linter', name, door, tool };
};

const formsOf = (door: string, exported: object): readonly Form[] =>
  Object.entries(exported).flatMap(([space, value]): Form[] => {
    if (space === PROGRAM) return [{ kind: 'program', name: space, door }];
    if (!Predicate.isObject(value) || Array.isArray(value)) return [];
    return Object.entries(value).flatMap(([member, make]) => {
      if (!Predicate.isFunction(make)) return [];
      const form = formOfMember(`${space}.${member}`, door, make as (options: object) => unknown);
      return form === undefined ? [] : [form];
    });
  });

export const FORMS: readonly Form[] = DOORS.flatMap(([door, exported]) => formsOf(door, exported));

export const formNamed = (name: string): Form | undefined => FORMS.find((one) => one.name === name);

export const formOf = (descriptor: Descriptor | { readonly builtin: string }): Form | undefined => {
  if ('builtin' in descriptor) return FORMS.find((one) => one.kind === 'builtin' && one.builtin === descriptor.builtin);
  if ('program' in descriptor) return formNamed(PROGRAM);
  const { tool } = descriptor.linter;
  return FORMS.find((one) => one.kind === 'linter' && one.tool === tool);
};
