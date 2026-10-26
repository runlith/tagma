import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { adapterOf, DECLARATIONS, NAMES, type Names, parseFacet } from '@runlith/code-facts/adapter';
import type { Import, Owner, OwnersAnswer, OwnersAsk } from './owners';

declare const self: Worker;

type Parsed = { readonly hash: number | bigint; readonly names: Names };

const RELATIVE = /^\.\.?(?:\/|$)/;

const memo = new Map<string, Parsed>();

const reads = (path: string): boolean => ADAPTERS.some((adapter) => adapter.declarations !== undefined && adapter.parses(path));

const declared = (root: string, path: string): Names => {
  const text = readFileSync(posix.join(root, path), 'utf8');
  const key = `${root}\0${path}`;
  const hash = Bun.hash(text);
  const held = memo.get(key);
  if (held !== undefined && held.hash === hash) return held.names;
  const names: Names =
    adapterOf(ADAPTERS, path).names === undefined
      ? { declarations: parseFacet(ADAPTERS, DECLARATIONS, text, path), imports: [] }
      : parseFacet(ADAPTERS, NAMES, text, path);
  memo.set(key, { hash, names });
  return names;
};

const answerOf = ({ id, root, name, paths }: OwnersAsk): OwnersAnswer => {
  const found: Owner[] = [];
  const imports: Import[] = [];
  const unparsed: string[] = [];
  for (const path of paths) {
    if (!reads(path)) continue;
    let names: Names;
    try {
      names = declared(root, path);
    } catch {
      unparsed.push(path);
      continue;
    }
    for (const one of names.declarations) if (one.name === name) found.push({ path, line: one.line, name });
    for (const one of names.imports)
      if (one.name === name && !RELATIVE.test(one.from))
        imports.push({ path, line: one.line, name, source: `${one.from}\0${one.imported}` });
  }
  return { id, found, imports, unparsed };
};

self.addEventListener('message', (event: MessageEvent<OwnersAsk>) => {
  self.postMessage(answerOf(event.data));
});
