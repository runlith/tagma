export type Anchor = {
  readonly target: string;
  readonly loader: string;
  readonly frame: string;
  readonly node: number;
};

export class Refs {
  #next = 0;
  readonly #byKey = new Map<string, string>();
  readonly #byRef = new Map<string, Anchor>();
  readonly #byLoader = new Map<string, Set<string>>();

  issue(anchor: Anchor): string {
    const key = `${anchor.target}|${anchor.loader}|${anchor.node}`;
    const known = this.#byKey.get(key);
    if (known !== undefined) return known;
    this.#next += 1;
    const ref = `e${this.#next}`;
    this.#byKey.set(key, ref);
    this.#byRef.set(ref, anchor);
    const issued = this.#byLoader.get(anchor.loader) ?? new Set<string>();
    issued.add(ref);
    this.#byLoader.set(anchor.loader, issued);
    return ref;
  }

  anchor(ref: string): Anchor | undefined {
    return this.#byRef.get(ref);
  }

  keep(loaders: ReadonlySet<string>): void {
    for (const loader of [...this.#byLoader.keys()]) if (!loaders.has(loader)) this.retire(loader);
  }

  retire(loader: string): void {
    const issued = this.#byLoader.get(loader);
    if (issued === undefined) return;
    this.#byLoader.delete(loader);
    for (const ref of issued) {
      const anchor = this.#byRef.get(ref);
      this.#byRef.delete(ref);
      if (anchor !== undefined) this.#byKey.delete(`${anchor.target}|${anchor.loader}|${anchor.node}`);
    }
  }
}
