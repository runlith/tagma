import type { MetadataInput } from '../metadata/sources.js';

export type TailEnd =
  | { readonly _tag: 'Completed'; readonly message: string | null }
  | { readonly _tag: 'Aborted' }
  | { readonly _tag: 'Failed'; readonly reason: string }
  | { readonly _tag: 'Open' };

export type TailWindow = { readonly since: number; readonly offset: number | null };

export type TailReader = {
  readonly shape: 'lines' | 'document';
  readonly window: 'time' | 'offset';
  readonly grain: number;
  readonly stampOf: (record: unknown) => number | null;
  readonly records?: (document: unknown) => readonly unknown[];
  readonly judge: (newestFirst: readonly unknown[], exhausted: boolean) => TailEnd | null;
};

export type TailLocation = { readonly root: string; readonly path: string };

export type TailSource = {
  readonly reader: TailReader;
  readonly locate: (input: MetadataInput) => TailLocation | null;
  readonly located: 'launch' | 'reported';
};

export type Fields = Readonly<Record<string, unknown>>;

export const fieldsOf = (value: unknown): Fields | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;

export const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export const blocksOf = (content: unknown): readonly Fields[] =>
  Array.isArray(content)
    ? content.flatMap((block): Fields[] => {
        const fields = fieldsOf(block);
        return fields === null ? [] : [fields];
      })
    : [];

export const textBlocks = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : blocksOf(content)
        .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
        .join('\n');

export const answered = (text: string): TailEnd => ({ _tag: 'Completed', message: text.trim() === '' ? null : text });

export const isoStamp = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

export class TailScan {
  private readonly seen: unknown[] = [];
  private ended: TailEnd | null = null;

  constructor(
    private readonly reader: TailReader,
    private readonly window: TailWindow,
  ) {}

  feed(newestFirst: readonly unknown[]): TailEnd | null {
    if (this.ended !== null) return this.ended;
    let exhausted = false;
    for (const record of newestFirst) {
      const at = this.reader.window === 'time' ? this.reader.stampOf(record) : null;
      if (at !== null && at + this.reader.grain <= this.window.since) {
        exhausted = true;
        break;
      }
      this.seen.push(record);
    }
    return this.settle(exhausted);
  }

  finish(): TailEnd {
    return this.ended ?? this.settle(true) ?? { _tag: 'Open' };
  }

  private settle(exhausted: boolean): TailEnd | null {
    const judged = this.reader.judge(this.seen, exhausted);
    if (judged !== null) this.ended = judged;
    else if (exhausted) this.ended = { _tag: 'Open' };
    return this.ended;
  }
}
