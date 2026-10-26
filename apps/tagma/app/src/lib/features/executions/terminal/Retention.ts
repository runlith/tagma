export interface RetentionLine {
  translateToString(trimRight?: boolean): string;
}

export interface RetentionBuffer {
  readonly baseY: number;
  readonly cursorX: number;
  readonly cursorY: number;
  getLine(y: number): RetentionLine | undefined;
}

export interface RetentionMark {
  readonly line: number;
  dispose(): void;
}

export interface RetentionEngine {
  readonly cols: number;
  readonly rows: number;
  readonly options: { readonly scrollback?: number };
  readonly buffer: { readonly active: RetentionBuffer };
  readonly parser: {
    registerOscHandler(ident: number, handler: (data: string) => boolean): { dispose(): void };
  };
  registerMarker(cursorYOffset?: number): RetentionMark;
}

const OSC_HYPERLINK = 8;

const CELL_UNITS = 2 * (1 + 30);

const LINK_URI_UNITS = 256;

export class TerminalRetention {
  private refusal: string | null = null;
  private links = 0;
  private mark: RetentionMark | null = null;
  private readonly keys = new Set<string>();
  private observer: { dispose(): void } | null;

  constructor(private readonly engine: RetentionEngine) {
    this.observer = engine.parser.registerOscHandler(OSC_HYPERLINK, (data) => {
      this.charge(data);
      return false;
    });
  }

  check(): string | null {
    if (this.refusal !== null) return this.refusal;
    const active = this.engine.buffer.active;
    const cells = this.engine.cols * CELL_UNITS;
    const cursor = active.baseY + active.cursorY;
    const held = Math.max(this.lineUnits(cursor), active.cursorX === 0 ? this.lineUnits(cursor - 1) : 0);
    if (held > cells) {
      this.refusal = `This terminal stopped taking output: one line grew to ${held} characters against the ${cells} a ${this.engine.cols}-column screen carries, so the program was growing one cell without end.`;
      return this.refusal;
    }
    const entries = this.linkCeiling();
    if (this.links > entries) {
      this.refusal = `This terminal stopped taking output: one line registered ${this.links} link entries against the ${entries} this screen keeps, and the engine holds every one of them until its line leaves the scrollback.`;
      return this.refusal;
    }
    return null;
  }

  dispose(): void {
    this.observer?.dispose();
    this.observer = null;
    this.mark?.dispose();
    this.mark = null;
    this.keys.clear();
  }

  private lineUnits(y: number): number {
    if (y < 0) return 0;
    return this.engine.buffer.active.getLine(y)?.translateToString(false).length ?? 0;
  }

  private linkCeiling(): number {
    return this.engine.rows + Math.max(0, this.engine.options.scrollback ?? 0);
  }

  private charge(data: string): void {
    const separator = data.indexOf(';');
    if (separator === -1) return;
    const uri = data.slice(separator + 1);
    if (uri === '') return;
    const active = this.engine.buffer.active;
    const line = active.baseY + active.cursorY;
    if (this.mark === null || this.mark.line !== line) {
      this.mark?.dispose();
      this.mark = this.engine.registerMarker();
      this.links = 0;
      this.keys.clear();
    }
    const id = identity(data.slice(0, separator).trim());
    if (id !== null) {
      const key = `${id};;${uri}`;
      if (this.keys.has(key)) return;
      this.keys.add(key);
    }
    this.links += 1 + Math.floor(uri.length / LINK_URI_UNITS);
  }
}

function identity(params: string): string | null {
  for (const part of params.split(':')) {
    if (part.startsWith('id=')) return part.slice(3) === '' ? null : part.slice(3);
  }
  return null;
}
