import type { SourceKind } from '../contract/wire/sources.js';
import type { TagReading } from '../contract/wire/tags/reading.js';
import { type BlockLine, blockLine, outlineIndent } from './lines.js';

export type ZoneSection = BlockLine & {
  readonly depth: number;
  readonly sources: readonly { readonly kind: SourceKind; readonly ref: string; readonly symbol: string | null }[];
  readonly body: string;
};

export function zoneSectionText(table: TagReading, section: ZoneSection): string {
  const lines = [`${outlineIndent(section.depth)}${blockLine(table, section)}`];
  for (const measured of section.sources) {
    lines.push(`${outlineIndent(section.depth)}source[${measured.kind}]: ${measured.ref}${measured.symbol ? `#${measured.symbol}` : ''}`);
  }
  const body = section.body.trim();
  if (body.length > 0) lines.push('', body, '');
  return lines.join('\n');
}

export type ZonePage = {
  readonly page: string;
  readonly shown: number;
  readonly next: string | null;
};

export function zonePage(table: TagReading, sections: readonly ZoneSection[], start: number, budget: number): ZonePage {
  const parts: string[] = [];
  let spent = 0;
  let index = start;
  while (index < sections.length) {
    const text = zoneSectionText(table, sections[index] as ZoneSection);
    if (parts.length > 0 && spent + text.length > budget) break;
    parts.push(text);
    spent += text.length;
    index += 1;
  }
  return {
    page: parts.join('\n'),
    shown: index - start,
    next: index >= sections.length ? null : ((sections[index - 1] as ZoneSection).name ?? null),
  };
}
