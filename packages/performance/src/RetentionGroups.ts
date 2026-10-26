export class RetentionGroups {
  private readonly depths = new Map<string, number>();

  get active(): number {
    return this.depths.size;
  }

  open(key: string): boolean {
    const depth = this.depths.get(key) ?? 0;
    this.depths.set(key, depth + 1);
    return depth === 0;
  }

  close(key: string): boolean {
    const depth = this.depths.get(key);
    if (depth === undefined || depth === 0) return false;
    if (depth > 1) {
      this.depths.set(key, depth - 1);
      return false;
    }
    this.depths.delete(key);
    return true;
  }

  clear(): void {
    this.depths.clear();
  }
}
