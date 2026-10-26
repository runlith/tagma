export class Descendants {
  private readonly paths = new Map<string, Set<string>>();

  within(scopes: readonly string[]): readonly string[] {
    const paths = new Set(scopes);
    for (const scope of scopes) for (const path of this.paths.get(scope) ?? []) paths.add(path);
    return [...paths];
  }

  add(path: string): void {
    this.index(path, true);
  }

  remove(path: string): void {
    this.index(path, false);
  }

  clear(): void {
    this.paths.clear();
  }

  private index(path: string, keep: boolean): void {
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
      const parent = path.slice(0, at);
      if (keep) {
        const paths = this.paths.get(parent) ?? new Set<string>();
        paths.add(path);
        this.paths.set(parent, paths);
      } else {
        const paths = this.paths.get(parent);
        paths?.delete(path);
        if (paths?.size === 0) this.paths.delete(parent);
      }
    }
  }
}
