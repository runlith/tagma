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
};

type CastRest = {
  readonly params?: {
    readonly sessionId?: unknown;
    readonly metadata?: { readonly deviceWidth?: unknown; readonly deviceHeight?: unknown };
  };
};

export function castFrame(text: string): CastFrame | undefined {
  const sliced = sliceData(text);
  const params = (sliced?.rest as CastRest | undefined)?.params;
  const ack = params?.sessionId;
  const width = params?.metadata?.deviceWidth;
  const height = params?.metadata?.deviceHeight;
  if (sliced === undefined || typeof ack !== 'number' || typeof width !== 'number' || typeof height !== 'number') return undefined;
  return { data: sliced.data, ack, width, height };
}
