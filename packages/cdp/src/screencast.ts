const FIELD = '"data":"';

export type Sliced = { readonly data: string; readonly rest: unknown };

export function sliceData(text: string): Sliced | undefined {
  const start = text.indexOf(FIELD);
  if (start < 0) return undefined;
  const from = start + FIELD.length;
  const end = text.indexOf('"', from);
  if (end < 0) return undefined;
  const rest =
    text[end + 1] === ','
      ? `${text.slice(0, start)}${text.slice(end + 2)}`
      : text[start - 1] === ','
        ? `${text.slice(0, start - 1)}${text.slice(end + 1)}`
        : `${text.slice(0, start)}${text.slice(end + 1)}`;
  try {
    return { data: text.slice(from, end), rest: JSON.parse(rest) as unknown };
  } catch {
    return undefined;
  }
}

export type CastFrame = {
  readonly data: string;
  readonly ack: number;
  readonly width: number;
  readonly height: number;
  readonly shownAt: number | null;
};

type CastRest = {
  readonly params?: {
    readonly sessionId?: unknown;
    readonly metadata?: { readonly deviceWidth?: unknown; readonly deviceHeight?: unknown; readonly timestamp?: unknown };
  };
};

export function castFrame(text: string): CastFrame | undefined {
  const sliced = sliceData(text);
  const params = (sliced?.rest as CastRest | undefined)?.params;
  const ack = params?.sessionId;
  const width = params?.metadata?.deviceWidth;
  const height = params?.metadata?.deviceHeight;
  const shown = params?.metadata?.timestamp;
  if (sliced === undefined || typeof ack !== 'number' || typeof width !== 'number' || typeof height !== 'number') return undefined;
  return { data: sliced.data, ack, width, height, shownAt: typeof shown === 'number' ? shown * 1000 : null };
}

const HEAD = 4096;

const FRAME_MARKERS: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const frameIn = (bytes: Uint8Array): { readonly width: number; readonly height: number } | 'short' | undefined => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let at = 2; ;) {
    if (at + 9 > bytes.length) return 'short';
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1]!;
    if (FRAME_MARKERS.has(marker)) return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]! };
    at += 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
  }
};

export function pictureSize(data: string): { readonly width: number; readonly height: number } | undefined {
  const head = frameIn(Buffer.from(data.slice(0, HEAD), 'base64'));
  if (head !== 'short') return head;
  const whole = frameIn(Buffer.from(data, 'base64'));
  return whole === 'short' ? undefined : whole;
}
