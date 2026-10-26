import { posix } from 'node:path';
import { type Adapter, adapterOf, type Adapters, type Facet } from './adapter';
import { type ImportReads, type ImportSite, readOf, UnsupportedSource } from './imports';
import type { Tree } from './tree';

export type ParseMemo = Map<string, readonly ImportSite[]>;

export type FacetMemo = Map<string, unknown>;

export type BlobText = { readonly object: string; readonly path: string; readonly text: string };

const readerOf = (adapters: Adapters, path: string): Adapter | undefined => adapters.find((adapter) => adapter.parses(path));

const PARSE_LANES = 4;

const keyOf = (object: string, adapter: Adapter, path: string): string => `${object}\0${adapter.id}\0${posix.extname(path)}`;

const facetKeyOf = (facet: Facet<unknown>, object: string, adapter: Adapter, path: string): string =>
  `${facet.id}\0${keyOf(object, adapter, path)}`;

export function blobTree(
  objects: ReadonlyMap<string, string>,
  texts: ReadonlyMap<string, string>,
  memo: ParseMemo,
  adapters: Adapters,
  missing?: Set<string>,
  facets?: FacetMemo,
): Tree {
  const held = (path: string): string | undefined => {
    const object = objects.get(path);
    const text = object === undefined ? undefined : texts.get(object);
    if (text === undefined && object !== undefined && missing !== undefined) missing.add(path);
    return text;
  };
  const read = (path: string): string => {
    const text = held(path);
    if (text !== undefined) return text;
    if (missing !== undefined && objects.has(path)) return '';
    throw new UnsupportedSource(path, `no text was read for ${objects.get(path) ?? 'a path the tree does not list'}`);
  };
  const sitesOf = (path: string): readonly ImportSite[] => {
    const adapter = adapterOf(adapters, path);
    const object = objects.get(path);
    if (object === undefined) return adapter.imports(read(path), path);
    const key = keyOf(object, adapter, path);
    const memoised = memo.get(key);
    if (memoised !== undefined) return memoised;
    const text = held(path);
    if (text === undefined && missing !== undefined) return [];
    const sites = adapter.imports(text ?? read(path), path);
    memo.set(key, sites);
    return sites;
  };
  const facetOf = <T>(path: string, facet: Facet<T>): T => {
    const adapter = adapterOf(adapters, path);
    const object = objects.get(path);
    if (object === undefined || facets === undefined) return facet.read(adapter, read(path), path);
    const key = facetKeyOf(facet, object, adapter, path);
    if (facets.has(key)) return facets.get(key) as T;
    const text = held(path);
    if (text === undefined && missing !== undefined) return facet.read(adapter, '', path);
    if (facet.withSites === undefined) {
      const found = facet.read(adapter, text ?? read(path), path);
      facets.set(key, found);
      return found;
    }
    const both = facet.withSites(adapter, text ?? read(path), path);
    facets.set(key, both.value);
    const parsed = keyOf(object, adapter, path);
    if (!memo.has(parsed)) memo.set(parsed, both.sites);
    return both.value;
  };
  return {
    has: (path) => objects.has(path),
    object: (path) => objects.get(path),
    read,
    paths: function* (prefix = '') {
      for (const path of objects.keys()) if (prefix === '' || path === prefix || path.startsWith(`${prefix}/`)) yield path;
    },
    sites: sitesOf,
    imports: (path, reads: ImportReads) => readOf(sitesOf(path), reads),
    facet: facetOf,
    size: (path) => {
      const object = objects.get(path);
      const text = object === undefined ? undefined : texts.get(object);
      return text === undefined ? undefined : Buffer.byteLength(text);
    },
  };
}

export const facetHeld = (facets: FacetMemo, adapters: Adapters, facet: Facet<unknown>, object: string, path: string): boolean => {
  const adapter = readerOf(adapters, path);
  return adapter !== undefined && facets.has(facetKeyOf(facet, object, adapter, path));
};

export const memoHolds = (memo: ParseMemo, adapters: Adapters, object: string, path: string): boolean => {
  const adapter = readerOf(adapters, path);
  return adapter !== undefined && memo.has(keyOf(object, adapter, path));
};

export async function parseAhead(memo: ParseMemo, adapters: Adapters, blobs: Iterable<BlobText>): Promise<void> {
  const queue: { readonly key: string; readonly blob: BlobText; readonly adapter: Adapter }[] = [];
  const queued = new Set<string>();
  for (const blob of blobs) {
    const adapter = readerOf(adapters, blob.path);
    if (adapter === undefined) continue;
    const key = keyOf(blob.object, adapter, blob.path);
    if (memo.has(key) || queued.has(key)) continue;
    queued.add(key);
    queue.push({ key, blob, adapter });
  }
  const parsed = async ({ blob, adapter }: (typeof queue)[number]): Promise<readonly ImportSite[]> =>
    adapter.importsOffThread === undefined ? adapter.imports(blob.text, blob.path) : adapter.importsOffThread(blob.text, blob.path);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < queue.length) {
      const held = queue[next++] as (typeof queue)[number];
      const sites = await parsed(held).catch(() => undefined);
      if (sites !== undefined) memo.set(held.key, sites);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARSE_LANES, queue.length) }, lane));
}
