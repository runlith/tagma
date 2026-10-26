import { posix } from 'node:path';

export const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;

const INDEXES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/index.cjs'] as const;

const TYPED: Readonly<Record<string, string>> = { '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts', '.cjs': '.cts' };

export const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

export const baseOf = (importer: string | null, specifier: string): string | null => {
  const base = posix.normalize(posix.join(importer === null ? '.' : posix.dirname(importer), specifier));
  return base === '..' || base.startsWith('../') ? null : base;
};

export const candidatesOf = (base: string): readonly string[] => {
  const extension = posix.extname(base);
  if ((EXTENSIONS as readonly string[]).includes(extension)) {
    const typed = TYPED[extension];
    return typed === undefined ? [base] : [base, `${base.slice(0, -extension.length)}${typed}`];
  }
  return [...EXTENSIONS.map((one) => `${base}${one}`), ...INDEXES.map((one) => `${base}${one}`)];
};

const lineWhere = (text: string, found: (line: string) => boolean): number | null => {
  const at = text.split('\n').findIndex(found);
  return at === -1 ? null : at + 1;
};

export const specifierLine = (text: string, specifier: string): number | null => {
  const quoted = [`'${specifier}'`, `"${specifier}"`, `\`${specifier}\``];
  return lineWhere(text, (line) => quoted.some((one) => line.includes(one)));
};

export const keyLine = (text: string, key: string): number | null => {
  const named = new RegExp(`(?:^|[\\s{,])(['"\`]?)${key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\1\\s*:`, 'u');
  return lineWhere(text, (line) => named.test(line));
};
