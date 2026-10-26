import { posix } from 'node:path';
import type { Adapters } from '@runlith/code-facts/adapter';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import { scriptsOf } from '@runlith/code-facts/adapters';
import { failureOf, parsedNow } from '@runlith/code-facts/js/imports';
import type { Tree } from '@runlith/code-facts/tree';
import { bare, inRegion } from '../../../core/params';
import type { Violation } from '../../../core/verdict';
import type { Budget } from '../../../core/node/budget';
import type { Implementation, ReadingScope } from '../../../core/node/reading';
import { localOf, mentionedIn, picks } from '../../../core/node/select';
import { allowedAt, type CallServicesParams, type TagRef } from './declaration';

type Node = { readonly type: string; readonly start: number; readonly end: number; readonly [key: string]: unknown };

type Receivers = { readonly Effect: ReadonlySet<string>; readonly Layer: ReadonlySet<string>; readonly Context: ReadonlySet<string> };

type Names = { readonly direct: ReadonlyMap<string, TagRef>; readonly spaces: ReadonlyMap<string, readonly TagRef[]> };

export type Site = { readonly line: number; readonly owner: string; readonly tag: string; readonly form: string };

const PROVIDES: Readonly<Record<keyof Receivers, ReadonlySet<string>>> = {
  Effect: new Set(['provideService', 'provideServiceEffect']),
  Layer: new Set(['succeed', 'effect', 'sync', 'scoped']),
  Context: new Set(),
};

const CARRIES: Readonly<Record<keyof Receivers, ReadonlySet<string>>> = {
  Effect: new Set(['provide', 'provideContext', 'setContext', 'updateContext']),
  Layer: new Set(['succeedContext', 'provide', 'provideMerge']),
  Context: new Set(),
};

const BUILDS: ReadonlySet<string> = new Set(['make', 'add']);

const WRAPPERS = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
]);

const isNode = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

const childOf = (node: Node, key: string): Node | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};

const childrenOf = (node: Node, key: string): readonly Node[] => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};

const unwrapped = (node: Node | undefined): Node | undefined => {
  let at = node;
  while (at !== undefined && WRAPPERS.has(at.type)) at = childOf(at, 'expression');
  return at;
};

const identifier = (node: Node | undefined): string | undefined =>
  node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : undefined;

const importedName = (node: Node | undefined): string | undefined =>
  identifier(node) ??
  ((node?.type === 'Literal' || node?.type === 'StringLiteral') && typeof node.value === 'string' ? node.value : undefined);

const resolvedFrom = (local: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined;
  const joined = posix.normalize(posix.join(posix.dirname(local), specifier));
  return joined.replace(/\.(m|c)?js$/, (_, kind: string | undefined) => `.${kind ?? ''}ts`);
};

const namesOf = (
  programs: readonly Node[],
  local: string,
  tags: readonly TagRef[],
): { readonly names: Names; readonly receivers: Receivers } => {
  const direct = new Map<string, TagRef>();
  const spaces = new Map<string, TagRef[]>();
  const receivers = { Effect: new Set<string>(), Layer: new Set<string>(), Context: new Set<string>() };
  for (const tag of tags) if (bare(tag.path) === local) direct.set(tag.symbol, tag);
  for (const program of programs) {
    for (const statement of childrenOf(program, 'body')) {
      if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
      const source = childOf(statement, 'source')?.value;
      if (typeof source !== 'string') continue;
      const file = resolvedFrom(local, source);
      const declared = file === undefined ? [] : tags.filter((tag) => bare(tag.path) === file);
      for (const specifier of childrenOf(statement, 'specifiers')) {
        if (specifier.importKind === 'type') continue;
        const name = identifier(childOf(specifier, 'local'));
        if (name === undefined) continue;
        if (specifier.type === 'ImportNamespaceSpecifier') {
          if (declared.length > 0) spaces.set(name, declared);
          continue;
        }
        const imported = specifier.type === 'ImportSpecifier' ? importedName(childOf(specifier, 'imported')) : undefined;
        if (imported === undefined) continue;
        if (source === 'effect' && (imported === 'Effect' || imported === 'Layer' || imported === 'Context')) receivers[imported].add(name);
        const tag = declared.find((one) => one.symbol === imported);
        if (tag !== undefined) direct.set(name, tag);
      }
    }
  }
  return { names: { direct, spaces }, receivers };
};

const tagOf = (raw: Node | undefined, names: Names): TagRef | undefined => {
  const node = unwrapped(raw);
  const name = identifier(node);
  if (name !== undefined) return names.direct.get(name);
  if (node?.type !== 'MemberExpression' || node.computed === true) return undefined;
  const space = identifier(unwrapped(childOf(node, 'object')));
  const member = identifier(childOf(node, 'property'));
  return space === undefined || member === undefined ? undefined : names.spaces.get(space)?.find((tag) => tag.symbol === member);
};

const memberOf = (
  raw: Node | undefined,
  receivers: Receivers,
): { readonly receiver: keyof Receivers; readonly name: string } | undefined => {
  const node = unwrapped(raw);
  if (node?.type !== 'MemberExpression' || node.computed === true) return undefined;
  const object = identifier(unwrapped(childOf(node, 'object')));
  const name = identifier(childOf(node, 'property'));
  if (object === undefined || name === undefined) return undefined;
  const receiver = (['Effect', 'Layer', 'Context'] as const).find((one) => receivers[one].has(object));
  return receiver === undefined ? undefined : { receiver, name };
};

const ownerOf = (statement: Node): string => {
  const inner =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? childOf(statement, 'declaration')
      : statement;
  if (inner === undefined) return '(top)';
  if (inner.type === 'VariableDeclaration') {
    const first = childrenOf(inner, 'declarations')[0];
    return identifier(first === undefined ? undefined : childOf(first, 'id')) ?? '(top)';
  }
  return identifier(childOf(inner, 'id')) ?? (statement.type === 'ExportDefaultDeclaration' ? 'default' : '(top)');
};

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

export const sitesIn = (path: string, local: string, text: string, tags: readonly TagRef[]): readonly Site[] => {
  const parsed = scriptsOf(text, path).map((script) => {
    const one = parsedNow(path, script);
    const failure = failureOf(one);
    if (failure !== undefined) throw new UnsupportedSource(path, failure.message);
    return { at: script.at, program: one.program as unknown as Node };
  });
  const { names, receivers } = namesOf(
    parsed.map((one) => one.program),
    local,
    tags,
  );
  if (names.direct.size === 0 && names.spaces.size === 0) return [];
  const starts = startsOf(text);
  const sites: (Site & { readonly offset: number })[] = [];
  for (const { at, program } of parsed) {
    const visit = (node: Node, owner: string, carried: boolean): void => {
      if (node.type === 'ImportDeclaration') return;
      let carries = carried;
      if (node.type === 'CallExpression') {
        const called = memberOf(childOf(node, 'callee'), receivers);
        const args = childrenOf(node, 'arguments');
        const provides = called !== undefined && PROVIDES[called.receiver].has(called.name);
        const builds = called !== undefined && called.receiver === 'Context' && BUILDS.has(called.name) && carried;
        if (called !== undefined && (provides || builds)) {
          for (const tag of args.map((one) => tagOf(one, names)).filter((one) => one !== undefined)) {
            const offset = at + node.start;
            sites.push({ offset, line: lineAt(starts, offset), owner, tag: tag.symbol, form: `${called.receiver}.${called.name}` });
          }
        }
        if (called !== undefined && CARRIES[called.receiver].has(called.name)) carries = true;
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
          for (const one of value) if (isNode(one)) visit(one, owner, carries);
        } else if (isNode(value)) visit(value, owner, carries);
      }
    };
    for (const statement of childrenOf(program, 'body')) visit(statement, ownerOf(statement), false);
  }
  return sites.sort((left, right) => left.offset - right.offset).map(({ line, owner, tag, form }) => ({ line, owner, tag, form }));
};

const selects = (params: CallServicesParams, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && inRegion(params, path) && picks(params.files, local) && !allowedAt(params, local);
};

const fixOf = (params: CallServicesParams, tag: string): string =>
  params.allow.length === 0
    ? `No file may provide \`${tag}\`: remove this provision.`
    : `Provide \`${tag}\` only in ${params.allow.map((one) => `\`${one}\``).join(', ')}: hand this call's facts to the code there instead of providing it here.`;

const read = (
  params: CallServicesParams,
  tree: Tree,
  paths: readonly string[],
  _adapters: Adapters,
  budget: Budget,
  _memo?: unknown,
  scope: ReadingScope = 'reach',
) => {
  const violations: Violation[] = [];
  const selected = [...new Set(paths)].filter((path) => tree.has(path) && selects(params, path)).sort();
  const mentioned = mentionedIn(
    tree,
    selected,
    params.tags.map((tag) => tag.symbol),
    scope,
  );
  const touched = mentioned === undefined ? selected : selected.filter((path) => mentioned.has(path));
  for (const path of touched) {
    budget.take(1, tree.size?.(path) ?? 0);
    const local = localOf(params.base, path) ?? path;
    const seen = new Map<string, number>();
    for (const site of sitesIn(path, local, tree.read(path), params.tags)) {
      const named = `${local} ${site.owner} ${site.tag} ${site.form}`;
      const count = (seen.get(named) ?? 0) + 1;
      seen.set(named, count);
      violations.push({
        fingerprint: count === 1 ? named : `${named}#${count}`,
        file: path,
        line: site.line,
        specifier: site.form,
        message: `provides the call service \`${site.tag}\` outside the places allowed to`,
        fix: fixOf(params, site.tag),
      });
    }
  }
  return { violations, unjudged: [] };
};

export const callServices: Implementation<CallServicesParams> = {
  lists: (params: CallServicesParams) => params.region.map((one) => (params.base === '' ? bare(one) : `${params.base}/${bare(one)}`)),
  selects,
  read,
  prefetch: false,
};
