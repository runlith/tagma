import type { ContractId } from './behaviour.js';
import type { Tag } from './declaration.js';

export const REFLECTION: ContractId = 'core/reflection';

export type Reflection = { readonly command: string; readonly expected: string; readonly actual: string };

export function reflectionOf(tag: Tag): Reflection | null {
  const slots = tag.contracts?.[REFLECTION]?.slots;
  const command = slots?.command;
  const expected = slots?.expected;
  const actual = slots?.actual;
  return command === undefined || expected === undefined || actual === undefined ? null : { command, expected, actual };
}
