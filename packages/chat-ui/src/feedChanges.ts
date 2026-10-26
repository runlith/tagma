import type { ChatEntry } from './entries';

export type FeedPatch<T> = { readonly kind: 'patch'; readonly at: number; readonly item: T };

export type FeedSplice<T> = {
  readonly kind: 'splice';
  readonly from: number;
  readonly removed: readonly T[];
  readonly inserted: readonly T[];
};

export type FeedChange<T> = FeedPatch<T> | FeedSplice<T>;

export type FeedChanges<T> = readonly FeedChange<T>[];

export interface FeedSource {
  readonly revision: number;
  readonly length: number;
  readonly entries: readonly ChatEntry[];
  since(revision: number): readonly FeedChanges<ChatEntry>[] | null;
  snapshot(): ChatEntry[];
}

const RETAINED_BATCHES = 16;

export class ChangeLog<B> {
  private held: { readonly revision: number; readonly batch: B }[] = [];
  revision = 0;

  record(batch: B): number {
    this.revision += 1;
    this.held.push({ revision: this.revision, batch });
    if (this.held.length > RETAINED_BATCHES) this.held.shift();
    return this.revision;
  }

  since(revision: number): readonly B[] | null {
    if (revision === this.revision) return [];
    const first = this.held[0];
    if (first === undefined || first.revision > revision + 1) return null;
    return this.held.filter((entry) => entry.revision > revision).map((entry) => entry.batch);
  }

  restart(): void {
    this.held = [];
    this.revision += 1;
  }
}

export function patchOf<T>(at: number, item: T): FeedPatch<T> {
  return { kind: 'patch', at, item };
}

export function spliceOf<T>(from: number, removed: readonly T[], inserted: readonly T[]): FeedSplice<T> {
  return { kind: 'splice', from, removed, inserted };
}
