type Held<V> = { readonly value: V; count: number };

export type Hold<V> = { readonly value: V; release(): void };

export class Holds<V> {
  private readonly held = new Map<string, Held<V>>();

  constructor(private readonly close: (value: V) => void) {}

  take(key: string, open: () => V): Hold<V> {
    let entry = this.held.get(key);
    if (entry === undefined) {
      entry = { value: open(), count: 0 };
      this.held.set(key, entry);
    }
    entry.count += 1;
    const taken = entry;
    let released = false;
    return {
      value: taken.value,
      release: () => {
        if (released) return;
        released = true;
        taken.count -= 1;
        if (taken.count > 0) return;
        if (this.held.get(key) === taken) this.held.delete(key);
        this.close(taken.value);
      },
    };
  }

  closeAll(): void {
    for (const entry of this.held.values()) this.close(entry.value);
    this.held.clear();
  }
}
