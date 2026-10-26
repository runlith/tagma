import type { Adapters } from '@runlith/code-facts/adapter';
import type { Tree } from '@runlith/code-facts/tree';
import type { Budget } from '@tagma/inspection/node/budget';
import type { Implementation, ReadingScope } from '@tagma/inspection/node/reading';
import { unitsOf, type Violation } from '@tagma/inspection/verdict';
import { bare, inRegion } from '../params';
import { localOf, mentionedIn, picks } from '../select';
import { allowedAt, type EnvironmentParams } from './declaration';
import { usesOf } from './reads';

const selects = (params: EnvironmentParams, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && inRegion(params, path) && picks(params.files, local);
};

const readsGlobal = (entry: string, read: string): boolean =>
  entry.includes('.') ? read === entry : read === entry || read.startsWith(`${entry}.`);

const importsSpecifier = (entry: string, specifier: string): boolean =>
  entry.endsWith('/*') ? specifier.startsWith(entry.slice(0, -1)) : specifier === entry;

const wordsOf = (params: EnvironmentParams): readonly string[] => [
  ...new Set([
    ...params.globals.map((one) => one.name.split('.').at(-1)!),
    ...params.imports.map((one) => one.specifier.replace(/\/\*$/u, '')),
  ]),
];

const startsOf = (text: string): readonly number[] => {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
};

const lineAt = (starts: readonly number[], offset: number): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] as number) <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
};

const fixOf = (entry: EnvironmentParams['globals'][number] | EnvironmentParams['imports'][number], use: string): string =>
  `Take ${entry.instead} instead of ${use}${
    entry.allow.length === 0 ? '' : `; only ${entry.allow.map((one) => `\`${one.path}\``).join(', ')} may touch it directly`
  }.`;

const judged = (params: EnvironmentParams, path: string, local: string, text: string): readonly Violation[] => {
  const uses = usesOf(path, text);
  const starts = startsOf(text);
  const violations: Violation[] = [];
  for (const use of uses.globals) {
    const entry = params.globals.find((one) => readsGlobal(one.name, use.name));
    if (entry === undefined || allowedAt(entry.allow, local)) continue;
    violations.push({
      fingerprint: `${local} ${entry.name}`,
      file: path,
      line: lineAt(starts, use.offset),
      specifier: use.name,
      message: `reads \`${use.name}\` directly`,
      fix: fixOf(entry, `reading \`${use.name}\``),
    });
  }
  for (const use of uses.imports) {
    const entry = params.imports.find((one) => importsSpecifier(one.specifier, use.name));
    if (entry === undefined || allowedAt(entry.allow, local)) continue;
    violations.push({
      fingerprint: `${local} import ${entry.specifier}`,
      file: path,
      line: lineAt(starts, use.offset),
      specifier: use.name,
      message: `imports \`${use.name}\` directly`,
      fix: fixOf(entry, `importing \`${use.name}\``),
    });
  }
  return violations.sort((left, right) => left.line - right.line);
};

const read = (
  params: EnvironmentParams,
  tree: Tree,
  paths: readonly string[],
  _adapters: Adapters,
  budget: Budget,
  _memo?: unknown,
  scope: ReadingScope = 'reach',
) => {
  const selected = [...new Set(paths)].filter((path) => tree.has(path) && selects(params, path)).sort();
  const mentioned = mentionedIn(tree, selected, wordsOf(params), scope);
  const touched = mentioned === undefined ? selected : selected.filter((path) => mentioned.has(path));
  const violations = touched.flatMap((path) => {
    budget.take(1, tree.size?.(path) ?? 0);
    return judged(params, path, localOf(params.base, path)!, tree.read(path));
  });
  return { violations: unitsOf(violations), unjudged: [] };
};

export const environment: Implementation<EnvironmentParams> = {
  lists: (params) => params.region.map((one) => (params.base === '' ? bare(one) : `${params.base}/${bare(one)}`)),
  selects,
  read,
  prefetch: false,
};
