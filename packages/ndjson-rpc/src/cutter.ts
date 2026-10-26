export type Cut =
  | { readonly _tag: 'Line'; readonly bytes: Uint8Array; readonly owned: boolean; readonly start: bigint; readonly end: bigint }
  | { readonly _tag: 'Over'; readonly start: bigint };

const NEWLINE = 0x0a;

export class LineCutter {
  private pieces: Array<Uint8Array> = [];
  private held = 0;
  private start: bigint;
  private skipping: boolean;
  private over = false;

  constructor(
    offset: bigint,
    torn: boolean,
    private readonly ceiling: number,
  ) {
    this.start = offset;
    this.skipping = torn;
  }

  cut(chunk: Uint8Array): ReadonlyArray<Cut> {
    if (this.over) return [];
    const cuts: Array<Cut> = [];
    let at = 0;
    if (this.skipping) {
      const newline = chunk.indexOf(NEWLINE);
      if (newline < 0) {
        this.start += BigInt(chunk.length);
        return cuts;
      }
      this.skipping = false;
      this.start += BigInt(newline + 1);
      at = newline + 1;
    }
    while (at < chunk.length) {
      const newline = chunk.indexOf(NEWLINE, at);
      const size = this.held + (newline < 0 ? chunk.length : newline) - at;
      if (size > this.ceiling) {
        this.over = true;
        this.pieces = [];
        cuts.push({ _tag: 'Over', start: this.start });
        return cuts;
      }
      if (newline < 0) {
        this.pieces.push(chunk.subarray(at));
        this.held = size;
        return cuts;
      }
      const tail = chunk.subarray(at, newline);
      const end = this.start + BigInt(size + 1);
      cuts.push(
        this.pieces.length === 0
          ? { _tag: 'Line', bytes: tail, owned: false, start: this.start, end }
          : { _tag: 'Line', bytes: this.joined(tail, size), owned: true, start: this.start, end },
      );
      this.start = end;
      at = newline + 1;
    }
    return cuts;
  }

  private joined(tail: Uint8Array, size: number): Uint8Array {
    const line = new Uint8Array(size);
    let at = 0;
    for (const piece of this.pieces) {
      line.set(piece, at);
      at += piece.length;
    }
    line.set(tail, at);
    this.pieces = [];
    this.held = 0;
    return line;
  }
}
