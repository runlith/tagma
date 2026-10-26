import { Argument, Flag } from 'effect/cli';
import { isBlockName } from '../contract/wire/references.js';

export function parseBlockName(ref: string): string {
  const name = ref.trim().toLowerCase().replaceAll('-', '');
  if (!isBlockName(name)) {
    throw new Error(`"${ref}" is not a block name; pass the name an answer printed, like 5940aab5`);
  }
  return name;
}

export const blockRef = (name: string) =>
  Argument.String(name).pipe(Argument.mapTryCatch(parseBlockName, (error) => String(error instanceof Error ? error.message : error)));

export const blockRefFlag = (name: string) =>
  Flag.String(name).pipe(Flag.mapTryCatch(parseBlockName, (error) => String(error instanceof Error ? error.message : error)));
