import type { FactFile, FactSide, ProgramFacts } from '@tagma/inspection/program';
import { type Adapter, contextDigest, DECLARATIONS, type Resolver } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { type BlobText, blobTree, type FacetMemo, memoHolds, type ParseMemo, parseAhead } from '@runlith/code-facts/blobs';
import { UnsupportedLanguage, UnsupportedSource } from '@runlith/code-facts/imports';
import { dependenciesOf, facetOf, type Tree } from '@runlith/code-facts/tree';
import { blobsAt } from '@runlith/git/entries';
import type { Git } from '@runlith/git/Git';
import { treeIdAt } from '@runlith/git/trees';
import { Effect } from 'effect';
import { inProgramReach } from '../programs/reach.js';
import type { FactsAsk } from './asks.js';
import { listingAt } from './treeMemo.js';
import { gitUnread, Unread } from './unread.js';

type Read = {
  readonly files: readonly FactFile[];
  readonly reached: readonly FactFile[];
  readonly unread: readonly string[];
  readonly complete: boolean;
};

const readerOf = (path: string): Adapter | undefined => ADAPTERS.find((adapter) => adapter.parses(path));

export const readSide = (ask: FactsAsk, side: FactsAsk['sides'][number]['side'], tree: Tree, paths: readonly string[]): Read => {
  const resolvers = new Map<Adapter, Resolver | null>();
  const resolverOf = (adapter: Adapter) => (): Resolver | null => {
    if (!resolvers.has(adapter)) resolvers.set(adapter, adapter.resolver?.(tree, '', ask.context[adapter.id] ?? {}) ?? null);
    return resolvers.get(adapter) ?? null;
  };
  let complete = true;
  const fileOf = (path: string, adapter: Adapter): FactFile => {
    try {
      const imports = ask.needs.includes('imports') ? dependenciesOf(tree, path, ADAPTERS, resolverOf(adapter)) : undefined;
      const lacking = ask.needs.includes('declarations') && adapter.declarations === undefined;
      const declarations = ask.needs.includes('declarations') && !lacking ? facetOf(tree, path, DECLARATIONS, ADAPTERS) : undefined;
      return {
        path,
        language: adapter.id,
        imports,
        declarations,
        lacks: lacking ? ['declarations' as const] : undefined,
      };
    } catch (error) {
      if (!(error instanceof UnsupportedSource) || error instanceof UnsupportedLanguage || side === 'tree') throw error;
      complete = false;
      return { path, language: adapter.id, unjudged: error.why };
    }
  };
  const files: FactFile[] = [];
  const unread: string[] = [];
  const asked = new Set(paths);
  for (const path of paths) {
    const adapter = readerOf(path);
    if (adapter === undefined) unread.push(path);
    else files.push(fileOf(path, adapter));
  }
  const reached: FactFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const one of file.imports ?? []) {
      if (!('path' in one.target) || asked.has(one.target.path) || seen.has(one.target.path)) continue;
      seen.add(one.target.path);
      const adapter = readerOf(one.target.path);
      if (adapter === undefined) unread.push(one.target.path);
      else reached.push(fileOf(one.target.path, adapter));
    }
  }
  return { files, reached, unread, complete };
};

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

export const factsAt = Effect.fn('inspecting.facts')(function* (git: Git['Service'], ask: FactsAsk, parses: ParseMemo, facets: FacetMemo) {
  const sides: FactSide[] = [];
  let hits = 0;
  for (const asked of ask.sides) {
    const listed = yield* listingAt(git, ask.root, asked.commit, ['']).pipe(Effect.mapError(gitUnread));
    const treeId = yield* treeIdAt(git, ask.root, asked.commit).pipe(Effect.mapError(gitUnread));
    const paths = (asked.paths ?? [...listed.ordered].filter((path) => ask.reaches.some((reach) => inProgramReach(reach, path)))).filter(
      (path) => listed.objects.has(path),
    );
    const texts = new Map<string, string>();
    const unread = new Map<string, string>();
    let wanted = paths.filter((path) => readerOf(path) !== undefined);
    hits += wanted.filter((path) => memoHolds(parses, ADAPTERS, listed.objects.get(path) as string, path)).length;
    for (;;) {
      const fresh = new Map<string, string>();
      for (const path of wanted) {
        const object = listed.objects.get(path) as string;
        if (!texts.has(object) && !unread.has(object) && !fresh.has(object)) fresh.set(object, path);
      }
      const asking = [...fresh];
      const reads = yield* blobsAt(
        git,
        ask.root,
        asking.map(([, path]) => ({ tree: asked.commit, path })),
      ).pipe(Effect.mapError(gitUnread));
      const blobs: BlobText[] = [];
      reads.forEach((read, at) => {
        const [object, path] = asking[at] as [string, string];
        if (read.status === 'text') {
          texts.set(object, read.text);
          blobs.push({ object, path, text: read.text });
        } else unread.set(object, read.status === 'unread' ? read.reason : 'git answered no such blob');
      });
      yield* Effect.promise(() => parseAhead(parses, ADAPTERS, blobs)).pipe(
        Effect.withSpan('inspecting.parse', { attributes: { files: blobs.length } }),
      );
      const missing = new Set<string>();
      const held = blobTree(listed.objects, texts, parses, ADAPTERS, missing, facets);
      let read: Read | undefined;
      let failed: unknown;
      try {
        read = readSide(ask, asked.side, { ...held, paths: (prefix?: string) => listed.ordered.under(prefix ?? '') }, paths);
      } catch (error) {
        failed = error;
      }
      const blocked = [...missing].find((path) => unread.has(listed.objects.get(path) as string));
      if (blocked !== undefined)
        return yield* new Unread({ cause: 'source', reason: `${blocked}: ${unread.get(listed.objects.get(blocked) as string)}` });
      if (missing.size > 0) {
        wanted = [...missing];
        continue;
      }
      if (read === undefined)
        return yield* new Unread({ cause: 'source', reason: failed instanceof Error ? failed.message : String(failed) });
      sides.push({ side: asked.side, commit: asked.commit, tree: treeId, ...read });
      break;
    }
  }
  const [first, ...rest] = sides;
  if (first === undefined) return yield* new Unread({ cause: 'source', reason: 'a facts ask names no side' });
  const adapters = ADAPTERS.map((adapter) => ({ id: adapter.id, context: contextDigest(ask.context[adapter.id] ?? {}) }));
  const facts: ProgramFacts = { adapters, bytes: 0, sides: [first, ...rest] };
  const placed = bytesOf(facts) - 1;
  let bytes = placed + 1;
  while (placed + String(bytes).length !== bytes) bytes = placed + String(bytes).length;
  if (bytes > ask.ceiling) {
    return yield* new Unread({
      cause: 'envelope',
      reason: `the facts snapshot needs ${bytes} bytes, above the ${ask.ceiling} bytes this machine allows one; a program that needs more asks for facts inside its run, a capability this release does not offer`,
    });
  }
  return { facts: { ...facts, bytes }, hits };
});
