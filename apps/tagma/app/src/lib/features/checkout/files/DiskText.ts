import { applyEdits, type LineEdit } from './lineDiff.js';

export class DiskText {
  private memo: string | null | undefined;

  private constructor(
    private readonly start: string,
    private readonly frames: readonly (readonly LineEdit[])[],
    readonly digest: string,
  ) {}

  static of(text: string, digest: string): DiskText {
    return new DiskText(text, [], digest);
  }

  after(edits: readonly LineEdit[], digest: string): DiskText {
    return new DiskText(this.start, [...this.frames, edits], digest);
  }

  read(): string | null {
    if (this.memo !== undefined) return this.memo;
    let text: string | null = this.start;
    for (const edits of this.frames) {
      text = text === null ? null : applyEdits(text, edits);
    }
    this.memo = text;
    return text;
  }
}
