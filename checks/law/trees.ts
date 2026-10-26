import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { ProgramSide } from '@tagma/inspection/program';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Facet } from '@runlith/code-facts/adapter';
import { blobTree, type ParseMemo } from '@runlith/code-facts/blobs';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import type { Tree } from '@runlith/code-facts/tree';
import { blobTexts, type Entry, entriesAt, git } from './git';

export type HeldBlobs = { readonly listings: Map<string, Map<string, Entry>>; readonly texts: Map<string, string> };

export const sideTree = (
  root: string,
  snapshot: string,
  side: ProgramSide,
  places: readonly string[],
  selects: (path: string) => boolean,
  memo: ParseMemo,
  held: HeldBlobs = { listings: new Map(), texts: new Map() },
): Tree => {
  const objects = new Map<string, string>();
  const texts = held.texts;
  let listed = new Map<string, Entry>();
  let complete: readonly string[] = [];
  if (side.paths !== null) {
    if (side.files === null) throw new Error(`the local ${side.side} side has no files`);
    const paths = new Set(side.paths);
    if (paths.size !== side.paths.length) throw new Error(`the ${side.side} side repeats a path`);
    for (const file of side.files) {
      if (!paths.has(file.path) || objects.has(file.path)) throw new Error(`unexpected or repeated ${side.side} file: ${file.path}`);
      const object = createHash('sha256').update(file.text).digest('hex');
      objects.set(file.path, object);
      texts.set(object, file.text);
    }
  } else {
    if (!/^[0-9a-f]{40,64}$/.test(snapshot)) throw new Error(`not a git object id: ${snapshot}`);
    const prefixes = [...new Set(places)].sort();
    const within = prefixes.includes('')
      ? []
      : prefixes.filter((one) => !prefixes.some((other) => other !== one && one.startsWith(`${other}/`)));
    const listing = `${snapshot}\0${within.join('\0')}`;
    listed = held.listings.get(listing) ?? entriesAt(root, snapshot, within, true);
    held.listings.set(listing, listed);
    complete = within.length === 0 ? [''] : within;
    for (const [path, entry] of listed) {
      if (!selects(path)) continue;
      if (entry.kind !== 'blob' || !['100644', '100755'].includes(entry.mode))
        throw new UnsupportedSource(path, `not a regular source file (${entry.mode} ${entry.kind})`);
      objects.set(path, entry.object);
    }
    for (const [object, text] of blobTexts(
      root,
      [...objects.values()].filter((object) => !texts.has(object)),
    ))
      texts.set(object, text);
  }
  const selected = new Map(objects);
  const supplied = new Set(side.paths ?? []);
  const context = new Map<string, ReadonlyMap<string, Entry>>();
  const entryAt = (path: string): Entry | undefined => {
    if (supplied.has(path)) return undefined;
    if (complete.some((prefix) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`))) return listed.get(path);
    const directory = posix.dirname(path);
    let entries = context.get(directory);
    if (entries === undefined) {
      const paths = directory === '.' ? [] : [`${directory}/`];
      entries = /^[0-9a-f]{40,64}$/.test(snapshot) ? entriesAt(root, snapshot, paths, false) : new Map();
      context.set(directory, entries);
    }
    const entry = entries.get(path);
    return entry?.kind === 'tree' ? undefined : entry;
  };
  const source = (path: string): void => {
    if (objects.has(path)) return;
    const entry = entryAt(path);
    if (entry === undefined) throw new UnsupportedSource(path, 'the snapshot does not list this source');
    if (entry.kind !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw new UnsupportedSource(path, `not a regular source file (${entry.mode} ${entry.kind})`);
    if (!texts.has(entry.object))
      texts.set(entry.object, new TextDecoder('utf-8', { fatal: true }).decode(git(root, ['cat-file', 'blob', entry.object])));
    objects.set(path, entry.object);
  };
  const loaded = blobTree(objects, texts, memo, ADAPTERS);
  return {
    ...loaded,
    has: (path) => objects.has(path) || entryAt(path) !== undefined,
    object: (path) => objects.get(path) ?? entryAt(path)?.object,
    read: (path) => {
      source(path);
      return loaded.read(path);
    },
    sites: (path) => {
      source(path);
      return loaded.sites!(path);
    },
    imports: (path, reads) => {
      source(path);
      return loaded.imports!(path, reads);
    },
    facet: <T>(path: string, facet: Facet<T>): T => {
      source(path);
      return loaded.facet!(path, facet);
    },
    size: (path) => {
      source(path);
      return loaded.size!(path);
    },
    paths: function* (prefix = '') {
      for (const path of selected.keys()) if (prefix === '' || path === prefix || path.startsWith(`${prefix}/`)) yield path;
    },
    mentions: (words) =>
      new Set([...selected].filter(([, object]) => words.some((word) => texts.get(object)!.includes(word))).map(([path]) => path)),
  };
};
