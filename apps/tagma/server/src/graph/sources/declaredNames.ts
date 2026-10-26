import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DECLARATIONS, parseFacet } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { UnsupportedLanguage, UnsupportedSource } from '@runlith/code-facts/imports';

export type DeclaredJob = { readonly root: string; readonly ref: string; readonly head: string };

export type Declared =
  | { readonly state: 'declared' }
  | { readonly state: 'undeclared'; readonly nearest: readonly string[] }
  | { readonly state: 'absent' }
  | { readonly state: 'unjudged' };

export type DeclaredAnswer =
  | { readonly state: 'judged'; readonly declared: Declared }
  | { readonly state: 'failed'; readonly message: string };

const NEAREST = 3;

const COMPARED = 64;

const missingFile = (error: unknown): boolean => ['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

const distance = (left: string, right: string): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const swap = left[row - 1] === right[column - 1] ? 0 : 1;
      current.push(
        Math.min((previous[column] as number) + 1, (current[column - 1] as number) + 1, (previous[column - 1] as number) + swap),
      );
    }
    previous = current;
  }
  return previous[right.length] as number;
};

const nearest = (head: string, names: readonly string[]): readonly string[] => {
  const wanted = head.toLowerCase().slice(0, COMPARED);
  return [...new Set(names)]
    .map((name) => ({ name, far: distance(wanted, name.toLowerCase().slice(0, COMPARED)) }))
    .sort((left, right) => left.far - right.far || left.name.localeCompare(right.name))
    .slice(0, NEAREST)
    .map((one) => one.name);
};

export const declaredAt = async (job: DeclaredJob): Promise<Declared> => {
  const text = await readFile(join(job.root, job.ref), 'utf8').catch((error: unknown) =>
    missingFile(error) ? null : Promise.reject(error),
  );
  if (text === null) return { state: 'absent' };
  let names: readonly string[];
  try {
    names = parseFacet(ADAPTERS, DECLARATIONS, text, job.ref).map((one) => one.name);
  } catch (error) {
    if (error instanceof UnsupportedLanguage || error instanceof UnsupportedSource) return { state: 'unjudged' };
    throw error;
  }
  return names.includes(job.head) ? { state: 'declared' } : { state: 'undeclared', nearest: nearest(job.head, names) };
};
