const grownFrom = new WeakMap<object, string>();

export function markAppended(entry: object, previous: string): void {
  grownFrom.set(entry, previous);
}

export function appendedFrom(entry: object): string | undefined {
  return grownFrom.get(entry);
}
