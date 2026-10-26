const names = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export type Ranked = { readonly name: string; readonly dir: boolean };

export const compareRanked = (left: Ranked, right: Ranked): number => {
  if (left.dir !== right.dir) return left.dir ? -1 : 1;
  return names.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
};

export const orderOf = (listed: readonly string[], dirs: readonly boolean[]): readonly number[] =>
  listed
    .map((name, index) => ({ name, dir: dirs[index] === true, index }))
    .sort(compareRanked)
    .map((row) => row.index);
