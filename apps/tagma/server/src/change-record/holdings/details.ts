import type { PackedVerdict } from '../lines/packed.js';

type Detail = { readonly print: string; readonly verdict: PackedVerdict; readonly bytes: number };

export class Details {
  private readonly entries = new Map<string, Detail>();
  private bytes = 0;

  constructor(readonly limit: number) {}

  get retained(): number {
    return this.bytes;
  }

  read(path: string, print: string): PackedVerdict | undefined {
    const entry = this.entries.get(path);
    if (entry === undefined || entry.print !== print) return undefined;
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.verdict;
  }

  keep(path: string, print: string, verdict: PackedVerdict | null): void {
    this.forget(path);
    if (verdict === null) return;
    const bytes = verdict.bytes + (path.length + print.length) * 2 + 256;
    if (bytes > this.limit) return;
    while (this.bytes + bytes > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.forget(oldest);
    }
    this.entries.set(path, { print, verdict, bytes });
    this.bytes += bytes;
  }

  forget(path: string): void {
    const entry = this.entries.get(path);
    if (entry === undefined) return;
    this.entries.delete(path);
    this.bytes -= entry.bytes;
  }
}
