import { escapeHtml } from '@runlith/utils/text';
import type { MarkedExtension, Tokens } from 'marked';

export type PathCode = { readonly path: string; readonly line: number | null; readonly column: number | null };

const SHAPE = /^([^\r\n]+?)(?::(\d+)(?::(\d+))?)?$/;
const ADDRESS =
  /(?<![\p{L}\p{N}_@./\\:~-])(?:[a-z]:[\\/]|([a-z][a-z0-9+.-]*:|\/\/)|\.{1,2}[\\/]|\/(?!\/)|[\p{L}\p{N}_@.-]+[\\/])(?:(?<=[\\/])<[\p{L}\p{N}_.-]+>(?=[\\/.\s`"'|«»“”)\]},;:!?]|$)|[^\s`"'<>|«»“”])+/giu;

export type PathMatch = { readonly index: number; readonly raw: string; readonly code: PathCode };

export function* pathMatches(text: string): Generator<PathMatch> {
  for (const hit of text.matchAll(ADDRESS)) {
    if (hit[1] !== undefined && !/^file:\/\//i.test(hit[0])) continue;
    let raw = hit[0];
    const balance = { ')': 0, ']': 0, '}': 0 };
    for (const char of raw) {
      if (char === '(') balance[')'] += 1;
      else if (char === '[') balance[']'] += 1;
      else if (char === '{') balance['}'] += 1;
      else if (char in balance) balance[char as keyof typeof balance] -= 1;
    }
    let end = raw.length;
    while (end > 0) {
      const last = raw[end - 1]!;
      if (/[.,;:!?]/.test(last)) end -= 1;
      else if (last in balance && balance[last as keyof typeof balance] < 0) {
        balance[last as keyof typeof balance] += 1;
        end -= 1;
      } else break;
    }
    raw = raw.slice(0, end);
    const code = pathCodeOf(raw);
    if (code !== null) yield { index: hit.index, raw, code };
  }
}

function pathHref(href: string): string | null {
  if (!/^file:\/\//i.test(href)) return href;
  try {
    return decodeURIComponent(new URL(href).pathname);
  } catch (cause) {
    if (!(cause instanceof URIError) && !(cause instanceof TypeError)) throw cause;
    return null;
  }
}

function pathHtml(tag: 'span' | 'code', code: PathCode, html: string): string {
  const line = code.line === null ? '' : ` data-line="${code.line}"`;
  const column = code.column === null ? '' : ` data-column="${code.column}"`;
  return `<${tag} data-path="${escapeHtml(code.path)}"${line}${column}>${html}</${tag}>`;
}

export function pathCodeOf(text: string): PathCode | null {
  const decoded = pathHref(text);
  const hit = decoded === null ? null : SHAPE.exec(decoded);
  if (hit === null) return null;
  const path = hit[1] as string;
  const line = hit[2] === undefined ? null : Number(hit[2]);
  return { path, line, column: hit[3] === undefined ? null : Number(hit[3]) };
}

export const pathCodes: MarkedExtension = {
  renderer: {
    link(token: Tokens.Link) {
      if (
        (!/^file:\/\//i.test(token.href) && !/^[a-z]:[\\/]/i.test(token.href) && /^[a-z][a-z0-9+.-]*:/i.test(token.href)) ||
        token.href.startsWith('#') ||
        token.href.startsWith('//')
      )
        return false;
      let href: string;
      try {
        href = /^file:\/\//i.test(token.href) ? token.href : decodeURIComponent(token.href);
      } catch (cause) {
        if (!(cause instanceof URIError) && !(cause instanceof TypeError)) throw cause;
        return `<span>${this.parser.parseInline(token.tokens)}</span>`;
      }
      const code = pathCodeOf(href);
      return code === null ? false : pathHtml('span', code, this.parser.parseInline(token.tokens));
    },
    codespan({ text }: { text: string }) {
      const code = pathCodeOf(text);
      if (code === null) return false;
      return pathHtml('code', code, escapeHtml(text));
    },
  },
  extensions: [
    {
      name: 'path',
      level: 'inline',
      start(src) {
        return pathMatches(src).next().value?.index;
      },
      tokenizer(src) {
        if (this.lexer.state.inLink) return undefined;
        const match = pathMatches(src).next().value;
        if (match?.index !== 0) return undefined;
        return { type: 'path', raw: match.raw, code: match.code };
      },
      renderer(token) {
        const path = token as { type: 'path'; raw: string; code: PathCode };
        return pathHtml('span', path.code, escapeHtml(path.raw));
      },
    },
  ],
};
