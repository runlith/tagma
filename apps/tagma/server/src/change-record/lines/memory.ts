import { totalmem } from 'node:os';
import type { FoldState, TextContent } from './folding.js';
import type { BaseAlignment } from './projection.js';

type Retained = { readonly bytes: number };
export const foldMemoryBudget = (): number => Math.min(256 * 1024 * 1024, Math.floor(totalmem() / 64));

type Entry<State extends Retained> =
  | { readonly kind: 'fold'; readonly value: State; readonly bytes: number }
  | { readonly kind: 'alignment'; readonly value: BaseAlignment; readonly bytes: number }
  | { readonly kind: 'oversized'; readonly bytes: number };
export type Retention =
  | { readonly kind: 'kept' }
  | { readonly kind: 'oversized'; readonly path: string; readonly bytes: number; readonly limit: number };

export class FoldMemory<State extends Retained = FoldState> {
  private readonly entries = new Map<string, Entry<State>>();
  private bytes = 0;
  private tinyNoted = false;
  constructor(readonly limit: number) {
    if (!Number.isFinite(limit) || limit < 0) throw new Error('the fold memory budget must be a nonnegative byte count');
  }
  get retained(): number {
    return this.bytes;
  }
  fold(path: string): State | undefined {
    const entry = this.touch(`fold:${path}`);
    return entry?.kind === 'fold' ? entry.value : undefined;
  }
  keep(path: string, state: State): Retention {
    const key = `fold:${path}`;
    const overhead = key.length * 2 + 128;
    if (state.bytes + overhead <= this.limit) {
      this.put(key, { kind: 'fold', value: state, bytes: state.bytes + overhead });
      return { kind: 'kept' };
    }
    const notice: Retention = { kind: 'oversized', path, bytes: state.bytes + overhead, limit: this.limit };
    const noted = this.entries.get(key)?.kind === 'oversized';
    if (overhead <= this.limit) this.put(key, { kind: 'oversized', bytes: overhead });
    else this.drop(key);
    if (!noted && (overhead <= this.limit || !this.tinyNoted)) console.warn('fold state exceeds its memory budget', notice);
    if (overhead > this.limit) this.tinyNoted = true;
    return notice;
  }
  alignment(before: TextContent, after: TextContent, normalized: boolean): BaseAlignment | undefined {
    const entry = this.touch(this.pair(before.blob, after.blob, normalized));
    return entry?.kind === 'alignment' && entry.value.beforeDigest === before.digest && entry.value.afterDigest === after.digest
      ? entry.value
      : undefined;
  }
  aligned(value: BaseAlignment): void {
    if ('reason' in value.aligned) return;
    const key = this.pair(value.from, value.to, value.normalized);
    this.put(key, { kind: 'alignment', value, bytes: 256 + value.aligned.changes.length * 128 + key.length * 2 });
  }
  forget(path: string): void {
    this.drop(`fold:${path}`);
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.tinyNoted = false;
  }
  private pair(from: string | null, to: string | null, normalized: boolean): string {
    return `base:${normalized ? 1 : 0}:${from === null ? -1 : from.length}:${from ?? ''}:${to ?? 'absent'}`;
  }
  private touch(key: string): Entry<State> | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  private put(key: string, entry: Entry<State>): void {
    this.drop(key);
    if (entry.bytes > this.limit) return;
    while (this.bytes + entry.bytes > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
  }
}
