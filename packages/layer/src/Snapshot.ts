import { Service, type AnyKeyClass } from './key.js';
import { Layer } from './Layer.js';

export interface SnapshotPart {
  take(): unknown;
  apply(value: unknown): void;
}

export const SNAPSHOT_FIELD = '__layer';

export class Snapshot extends Service<Snapshot>()('Snapshot', { tier: 'app' }) {
  static make(): Snapshot {
    return new Snapshot();
  }

  static part = Layer.member(
    () => Snapshot,
    (snapshot: Snapshot, part: SnapshotPart, key: AnyKeyClass) => snapshot.add(key.id, part),
  );

  private readonly parts = new Map<string, SnapshotPart>();
  private readonly pending = new Map<string, unknown>();
  private applied: unknown;

  add(id: string, part: SnapshotPart): () => void {
    this.parts.set(id, part);
    if (this.pending.has(id)) {
      const value = this.pending.get(id);
      this.pending.delete(id);
      part.apply(value);
    }
    return () => {
      if (this.parts.get(id) === part) this.parts.delete(id);
    };
  }

  take(): Record<string, unknown> {
    const record: Record<string, unknown> = {};
    for (const [id, part] of this.parts) record[id] = part.take();
    return record;
  }

  apply(record: unknown): void {
    if (record === undefined || record === null || record === this.applied) return;
    this.applied = record;
    if (typeof record !== 'object') return;
    for (const [id, value] of Object.entries(record as Record<string, unknown>)) {
      if (value === undefined) continue;
      const part = this.parts.get(id);
      if (part) part.apply(value);
      else this.pending.set(id, value);
    }
  }

  static field(record: Record<string, unknown>): Record<string, unknown> {
    return { [SNAPSHOT_FIELD]: record };
  }

  static of(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) return undefined;
    return (data as Record<string, unknown>)[SNAPSHOT_FIELD];
  }
}
