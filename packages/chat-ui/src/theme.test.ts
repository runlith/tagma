import { describe, expect, it } from 'vitest';
import { parse } from 'svelte/compiler';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));

const PRODUCT_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
];

const NON_COLOUR_TAILS = [
  'xs',
  'sm',
  'base',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  'left',
  'center',
  'right',
  'start',
  'end',
  'justify',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  'transparent',
  'current',
  'inherit',
  'none',
  'hidden',
  'inner',
  'solid',
  'dashed',
  'dotted',
  'double',
  'collapse',
  'separate',
  'inset',
  'offset',
  'cover',
  'contain',
  'fixed',
  'local',
  'scroll',
  'auto',
  't',
  'r',
  'b',
  'l',
  'x',
  'y',
  's',
  'e',
  'width',
  'linecap',
  'linejoin',
  'dasharray',
];

const COLOUR_CLASS =
  /(?:^|[\s"'`{[])(?:bg|text|border|ring|fill|stroke|outline|shadow|decoration|divide|accent|caret|placeholder|from|via|to)-([a-z][a-z0-9-]*)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.name.endsWith('.test.ts')) return [];
    return entry.name.endsWith('.svelte') || entry.name === 'composerFrame.ts' ? [path] : [];
  });
}

const DECLARED = new Set(
  [...readFileSync(resolve(source, 'theme.css'), 'utf8').matchAll(/--(?:color|text|shadow)-([a-z0-9-]+?)(?:--[a-z-]+)?:/g)].map(
    ([, name]) => name,
  ),
);

function foreignTokens(text: string): string[] {
  const found = new Set<string>();
  for (const [, tail] of text.matchAll(COLOUR_CLASS)) {
    if (!tail) continue;
    if (DECLARED.has(tail)) continue;
    if (PRODUCT_TOKENS.includes(tail)) continue;
    if (NON_COLOUR_TAILS.includes(tail)) continue;
    if (/^\d/.test(tail) || /^[trblxyse]-\d/.test(tail)) continue;
    found.add(tail);
  }
  return [...found];
}

describe('chat-ui theme', () => {
  it('declares no colour of its own', () => {
    const theme = readFileSync(resolve(source, 'theme.css'), 'utf8');
    expect(theme.match(/oklch\(|rgba?\(|hsla?\(|#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('reaches for no token outside the base every product declares', () => {
    const leaks = sourceFiles(source).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      const style = path.endsWith('.svelte') ? parse(text).css : null;
      const tokens = foreignTokens(style ? text.slice(0, style.start) + text.slice(style.end) : text);
      return tokens.map((token) => `${path.slice(source.length + 1)}: ${token}`);
    });
    expect(leaks).toEqual([]);
  });
});
