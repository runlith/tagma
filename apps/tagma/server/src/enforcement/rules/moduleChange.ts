import type { ModuleChange } from '../contract/wire/modules.js';

export type ChangePart = 'put' | 'drop' | 'replace';

export type ChangeFault = (part: ChangePart, index: number, said: string, fix: string) => void;

export const changedSet = <Item, Key extends string | number>(
  standing: readonly Item[],
  change: ModuleChange<Item | undefined, Key | undefined>,
  keyOf: (item: Item) => Key,
  shown: (key: Key) => string,
  fault: ChangeFault,
): readonly Item[] => {
  const firsts = <T>(part: ChangePart, listed: readonly (T | undefined)[], keyed: (one: T) => Key): Map<Key, number> => {
    const seen = new Map<Key, number>();
    listed.forEach((one, index) => {
      if (one === undefined) return;
      const key = keyed(one);
      if (seen.has(key)) fault(part, index, `${shown(key)} is written twice in this list`, 'write it once');
      else seen.set(key, index);
    });
    return seen;
  };

  if ('replace' in change) {
    const first = firsts('replace', change.replace, keyOf);
    return change.replace.flatMap((one, index) => (one !== undefined && first.get(keyOf(one)) === index ? [one] : []));
  }

  const putAt = firsts('put', change.put ?? [], keyOf);
  const dropAt = firsts('drop', change.drop ?? [], (key: Key) => key);
  const stands = new Set(standing.map(keyOf));
  for (const [key, index] of dropAt) {
    if (putAt.has(key)) fault('drop', index, `${shown(key)} is also in put, which replaces whole`, 'name it in one of the two lists');
    else if (!stands.has(key))
      fault('drop', index, `${shown(key)} does not stand, so there is nothing to drop`, 'check its spelling against the card');
  }
  const put = new Map<Key, Item>();
  (change.put ?? []).forEach((one, index) => {
    if (one !== undefined && putAt.get(keyOf(one)) === index) put.set(keyOf(one), one);
  });
  return [
    ...standing.filter((one) => !dropAt.has(keyOf(one))).map((one) => put.get(keyOf(one)) ?? one),
    ...[...put].filter(([key]) => !stands.has(key)).map(([, one]) => one),
  ];
};
