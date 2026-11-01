import { PROJECTION_BYTES, type RowCommit } from '@runlith/sqlite-process/channel';

const COMMITS = 64;

export class RowBuffer {
  private queued: RowCommit[] = [];
  private bytes = 0;
  private floor = -1;

  push(commit: RowCommit): void {
    if (commit._tag === 'Gap') {
      this.clear(commit.cursor);
      return;
    }
    this.queued.push(commit);
    this.bytes += commit.bytes;
    while (this.queued.length > COMMITS || this.bytes > PROJECTION_BYTES) {
      const dropped = this.queued.shift()!;
      this.bytes -= dropped.bytes;
      this.floor = dropped.cursor;
    }
  }

  after(cursor: number): readonly RowCommit[] | null {
    if (cursor < this.floor) return null;
    return this.queued.filter((commit) => commit.cursor > cursor);
  }

  clear(floor: number): void {
    this.queued = [];
    this.bytes = 0;
    this.floor = floor;
  }
}
