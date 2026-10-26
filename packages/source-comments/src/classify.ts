import type { CommentMarker, CommentRange, Directive, Language } from './language.js';

export type CommentKind = 'prose' | 'directive' | 'marked';

function opensWith(candidate: string, rows: readonly Directive[], side: Directive['side']): boolean {
  const head = candidate.trimStart();
  return rows.some((row) => row.side === side && head.startsWith(row.opens));
}

function bare(line: string, continuation: string): string {
  let at = 0;
  while (at < line.length && (line[at] === ' ' || line[at] === '\t')) at += 1;
  while (line.startsWith(continuation, at)) at += continuation.length;
  return line.slice(at);
}

export function kindOf(language: Language, range: CommentRange, raw: string): CommentKind {
  const content = range.text;
  if (content.startsWith('!')) return 'marked';
  if (opensWith(content, language.directives, 'content') || opensWith(raw, language.directives, 'raw')) {
    return 'directive';
  }
  const continuation = language.continuation;
  if (continuation !== undefined && content.trimStart().startsWith(continuation)) {
    for (const line of content.split('\n')) {
      if (opensWith(bare(line, continuation), language.directives, 'content')) return 'directive';
    }
  }
  return 'prose';
}

export function isFileMarker(marker: CommentMarker, raw: string): boolean {
  const only = raw.trim();
  if (marker.line !== undefined && only === `${marker.line}! comments`) return true;
  if (marker.block !== undefined && only === `${marker.block.open}! comments ${marker.block.close}`) return true;
  return false;
}
