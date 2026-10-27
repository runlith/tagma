import { isAbsolute, relative } from 'node:path';
import {
  impliedBy,
  literalGlob,
  namedBy,
  type CommandFacts,
  type CommandPart,
  type CommandPath,
} from '@runlith/agent-tools/WorkspaceChanges';

export type Role =
  | { readonly kind: 'writer' }
  | { readonly kind: 'reader'; readonly implicit: readonly string[] }
  | { readonly kind: 'named'; readonly paths: readonly CommandPath[]; readonly implicit: readonly string[] };

export const WRITER: Role = { kind: 'writer' };

const within = (tree: string, path: string): string | null => {
  const name = relative(tree, path);
  return name.startsWith('..') || isAbsolute(name) ? null : name;
};

export const signatureIn = (tree: string, signature: string | null): string | null => {
  if (signature === null) return null;
  const at = signature.lastIndexOf(' /');
  const path = at === -1 ? (signature.startsWith('/') ? signature : null) : signature.slice(at + 1);
  if (path === null) return signature;
  const name = within(tree, path);
  return name === null ? null : `${signature.slice(0, signature.length - path.length)}${name}`;
};

export type Learned = 'reader' | 'writer';

export const learns = (part: CommandPart): boolean => !part.readsOnly && (part.named === null || part.listed);

const taught = (part: CommandPart, learned: Learned | null): CommandPart =>
  learned === 'writer'
    ? { ...part, named: null, listed: false }
    : learned === 'reader' && part.named === null && !part.listed
      ? { ...part, named: [], listed: true }
      : part;

export const roleOf = (facts: CommandFacts, tree: string, learned: (signature: string) => Learned | null): Role => {
  const paths: CommandPath[] = [];
  const implicit: string[] = [];
  let named = false;
  for (const given of facts.parts) {
    if (given.readsOnly) continue;
    const signature = learns(given) ? signatureIn(tree, given.signature) : null;
    const part = signature === null ? given : taught(given, learned(signature));
    if (part.named === null) return WRITER;
    for (const path of part.named) {
      const name = typeof path === 'string' ? within(tree, path) : within(literalGlob(tree), path.glob);
      if (name !== null) paths.push(typeof path === 'string' ? name : { glob: name });
    }
    if (part.listed) implicit.push(...part.implicit);
    else named = true;
  }
  return named || paths.length > 0 ? { kind: 'named', paths, implicit } : { kind: 'reader', implicit };
};

export const covers = (role: Role, name: string): boolean => {
  if (role.kind === 'writer') return true;
  if (impliedBy(role.implicit, name)) return true;
  return role.kind === 'named' && namedBy(role.paths, name);
};

export const explains = (role: Role, name: string): boolean => role.kind !== 'writer' && covers(role, name);
