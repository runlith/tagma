export type FavoritePair = { readonly provider: string; readonly model: string };

function same(a: FavoritePair, b: FavoritePair): boolean {
  return a.provider === b.provider && a.model === b.model;
}

export function toggled(list: readonly FavoritePair[], pair: FavoritePair): readonly FavoritePair[] {
  return list.some((one) => same(one, pair)) ? list.filter((one) => !same(one, pair)) : [...list, pair];
}

export function movedBefore(list: readonly FavoritePair[], from: FavoritePair, before: FavoritePair | null): readonly FavoritePair[] {
  const moved = list.find((one) => same(one, from));
  if (moved === undefined) return list;
  const rest = list.filter((one) => one !== moved);
  const at = before === null ? -1 : rest.findIndex((one) => same(one, before));
  return at < 0 ? [...rest, moved] : [...rest.slice(0, at), moved, ...rest.slice(at)];
}
