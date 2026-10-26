const BEL = 0x07;
const CAN = 0x18;
const SUB = 0x1a;
const ESC = 0x1b;
const ST8 = 0x9c;

const OSC_AFTER_ESC = 0x5d;
const OSC_DIRECT = 0x9d;
const STRING_AFTER_ESC = new Set([0x50, 0x5f, 0x5e, 0x58]);
const STRING_DIRECT = new Set([0x90, 0x9f, 0x9e, 0x98]);

export type GuardVerdict = { readonly accepted: number; readonly open: number };

export class StringGuard {
  private state: 'ground' | 'esc' | 'osc' | 'string' = 'ground';
  private open = 0;
  private pending = 0;
  private needed = 0;
  private held = 0;

  reset(): void {
    this.state = 'ground';
    this.open = 0;
  }

  get standing(): number {
    return this.open;
  }

  admit(bytes: Uint8Array, allowance: number): GuardVerdict {
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index] as number;
      const inside = this.state === 'osc' || this.state === 'string';
      if (inside && this.open + 1 > allowance) return { accepted: index, open: this.open };
      if (inside) this.open += 1;
      const point = this.decode(byte);
      if (point !== undefined) this.step(point);
    }
    return { accepted: bytes.length, open: this.open };
  }

  private decode(byte: number): number | undefined {
    if (this.needed > 0) {
      if ((byte & 0xc0) !== 0x80) {
        this.needed = 0;
        this.pending = 0;
        this.held = 0;
        return this.decode(byte);
      }
      this.pending = (this.pending << 6) | (byte & 0x3f);
      this.held += 1;
      if (this.held < this.needed) return undefined;
      const point = this.pending;
      this.needed = 0;
      this.pending = 0;
      this.held = 0;
      return point;
    }
    if (byte < 0x80) return byte;
    if ((byte & 0xe0) === 0xc0) {
      this.pending = byte & 0x1f;
      this.needed = 1;
      this.held = 0;
      return undefined;
    }
    if ((byte & 0xf0) === 0xe0) {
      this.pending = byte & 0x0f;
      this.needed = 2;
      this.held = 0;
      return undefined;
    }
    if ((byte & 0xf8) === 0xf0) {
      this.pending = byte & 0x07;
      this.needed = 3;
      this.held = 0;
      return undefined;
    }
    return undefined;
  }

  private step(byte: number): void {
    switch (this.state) {
      case 'ground':
        if (byte === ESC) this.state = 'esc';
        else if (byte === OSC_DIRECT) this.begin('osc');
        else if (STRING_DIRECT.has(byte)) this.begin('string');
        break;
      case 'esc':
        if (byte === OSC_AFTER_ESC) this.begin('osc');
        else if (STRING_AFTER_ESC.has(byte)) this.begin('string');
        else this.state = byte === ESC ? 'esc' : 'ground';
        break;
      case 'osc':
        if (byte === BEL || byte === ST8 || byte === CAN || byte === SUB) this.reset();
        else if (byte === ESC) this.opened();
        break;
      case 'string':
        if (byte === ST8 || byte === CAN || byte === SUB) this.reset();
        else if (byte === ESC) this.opened();
        break;
    }
  }

  private begin(kind: 'osc' | 'string'): void {
    this.state = kind;
    this.open = 0;
  }

  private opened(): void {
    this.state = 'esc';
    this.open = 0;
  }
}
