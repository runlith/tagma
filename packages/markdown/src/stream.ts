import { Lexer, type Links, type MarkedOptions, type Token, type Tokens } from 'marked';
import remend from 'remend';

export type MarkdownBlock = {
  mode: 'full' | 'live' | 'open-code';
  start: number;
  end: number;
  raw: string;
  src: string;
};

export type MarkdownSplit = {
  settled: MarkdownBlock[];
  open: MarkdownBlock[];
  definitions: Tokens.Def[];
  end: number;
};

type Group = { token: Token; start: number; end: number };

const ABSORBING = new Set(['paragraph', 'list', 'blockquote', 'table']);

const definitionsKeptAsBlocks = new Proxy<Links>(Object.create(null), { set: () => true });

type Tail = { source: string; groups: Group[]; at: (offset: number) => number };

export function splitMarkdown(text: string, from: number, grammar: MarkedOptions): MarkdownSplit {
  const tail = tailOf(text, from, grammar);
  const { source, groups } = tail;
  const live = groups.at(-1);
  const end = text.length;
  if (!live) {
    return { settled: [], open: [{ mode: 'live', start: from, end, raw: source, src: healMarkdown(source) }], definitions: [], end: from };
  }

  const previous = groups.at(-2);
  const held = previous && ABSORBING.has(previous.token.type) && !endsBlank(source, previous) ? 1 : 0;
  const settled = groups.slice(0, groups.length - 1 - held);
  const open = groups.slice(groups.length - 1 - held, -1).map((group) => fullBlock(tail, group));
  const raw = source.slice(live.start);
  const start = tail.at(live.start);
  open.push(
    live.token.type === 'code' && hasOpenFence(live.token.raw)
      ? { mode: 'open-code', start, end, raw, src: raw }
      : { mode: 'live', start, end, raw, src: healMarkdown(raw) },
  );

  return {
    settled: settled.map((group) => fullBlock(tail, group)),
    open,
    definitions: definitionsOf(settled),
    end: open[0]?.start ?? start,
  };
}

export function finishMarkdown(text: string, from: number, grammar: MarkedOptions): MarkdownSplit {
  const tail = tailOf(text, from, grammar);
  return {
    settled: tail.groups.map((group) => fullBlock(tail, group)),
    open: [],
    definitions: definitionsOf(tail.groups),
    end: text.length,
  };
}

function tailOf(text: string, from: number, grammar: MarkedOptions): Tail {
  const tail = text.slice(from);
  const source = tail.replace(/\r\n?/g, '\n');
  const original = source.length === tail.length ? (offset: number) => offset : originalOffsets(tail);
  return { source, groups: blockGroups(source, grammar), at: (offset) => from + original(offset) };
}

function fullBlock(tail: Tail, group: Group): MarkdownBlock {
  const raw = tail.source.slice(group.start, group.end);
  return { mode: 'full', start: tail.at(group.start), end: tail.at(group.end), raw, src: raw };
}

function definitionsOf(groups: readonly Group[]): Tokens.Def[] {
  return groups.flatMap((group) => definitionsIn(group.token));
}

function definitionsIn(token: Token): Tokens.Def[] {
  if (token.type === 'def') return [token as Tokens.Def];
  if (token.type === 'blockquote') return (token as Tokens.Blockquote).tokens.flatMap(definitionsIn);
  if (token.type === 'list') return (token as Tokens.List).items.flatMap((item) => item.tokens.flatMap(definitionsIn));
  return [];
}

export function settledBlock(text: string, start: number, end: number): MarkdownBlock {
  const raw = text.slice(start, end).replace(/\r\n?/g, '\n');
  return { mode: 'full', start, end, raw, src: raw };
}

function blockGroups(source: string, grammar: MarkedOptions): Group[] {
  const lexer = new Lexer(grammar);
  lexer.tokens.links = definitionsKeptAsBlocks;
  const groups: Group[] = [];
  let offset = 0;
  for (const token of lexer.blockTokens(source)) {
    const start = offset;
    offset += token.raw.length;
    const last = groups.at(-1);
    if (token.type !== 'space') groups.push({ token, start, end: offset });
    else if (last) last.end = offset;
  }
  return groups;
}

function endsBlank(source: string, group: Group): boolean {
  let breaks = 0;
  for (let at = group.end - 1; at >= group.start; at -= 1) {
    const char = source[at];
    if (char === '\n') breaks += 1;
    else if (char !== ' ' && char !== '\t') return false;
    if (breaks === 2) return true;
  }
  return false;
}

function originalOffsets(tail: string): (normalized: number) => number {
  let read = 0;
  let offset = 0;
  return (normalized) => {
    if (normalized < read) {
      read = 0;
      offset = 0;
    }
    for (; read < normalized; read += 1) offset += tail[offset] === '\r' && tail[offset + 1] === '\n' ? 2 : 1;
    return offset;
  };
}

function healMarkdown(text: string): string {
  return remend(text, { linkMode: 'text-only' });
}

function hasOpenFence(raw: string): boolean {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  if (!match) return false;

  const mark = match[1];
  if (!mark) return false;

  const fence = mark[0];
  const size = mark.length;
  const body = raw.trimEnd();
  const last = body.slice(body.lastIndexOf('\n') + 1).trim();
  return !new RegExp(`^[\\t ]{0,3}${fence}{${size},}[\\t ]*$`).test(last);
}
