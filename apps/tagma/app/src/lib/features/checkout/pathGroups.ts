export type PathGroup<T extends { readonly path: string }> = { readonly directory: string; readonly entries: readonly T[] };

export function pathGroups<T extends { readonly path: string }>(entries: readonly T[]): readonly PathGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const cut = entry.path.lastIndexOf('/');
    const directory = cut === -1 ? '' : entry.path.slice(0, cut + 1);
    const held = groups.get(directory);
    if (held === undefined) groups.set(directory, [entry]);
    else held.push(entry);
  }
  return [...groups].map(([directory, held]) => ({ directory, entries: held }));
}
