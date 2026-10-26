type Piece = { readonly start: number; readonly pcm: Int16Array };

export class Recording {
  private pieces: Array<Piece> = [];
  private written = 0;

  get length(): number {
    return this.written;
  }

  push(pcm: Int16Array): void {
    this.pieces.push({ start: this.written, pcm });
    this.written += pcm.length;
  }

  slice(from: number, to: number): Int16Array {
    const start = Math.max(0, Math.floor(from));
    const end = Math.min(this.written, Math.ceil(to));
    const out = new Int16Array(Math.max(0, end - start));
    for (const piece of this.pieces) {
      const pieceEnd = piece.start + piece.pcm.length;
      if (pieceEnd <= start || piece.start >= end) continue;
      const lower = Math.max(start, piece.start);
      const upper = Math.min(end, pieceEnd);
      out.set(piece.pcm.subarray(lower - piece.start, upper - piece.start), lower - start);
    }
    return out;
  }

  trim(before: number): void {
    let keep = 0;
    while (keep < this.pieces.length) {
      const piece = this.pieces[keep];
      if (piece === undefined || piece.start + piece.pcm.length > before) break;
      keep += 1;
    }
    if (keep > 0) this.pieces = this.pieces.slice(keep);
  }
}
