import createDOMPurify from 'dompurify';
import { Lexer, type Links, Marked, type MarkedExtension, type MarkedOptions, type Token, Tokenizer, type Tokens } from 'marked';
import { type CodeColours, normalizeCodeLanguage, plainCodeHtml, visibleCode } from '@runlith/highlight/colours';
import { highlightLinesOffThread } from '@runlith/highlight/offThread';
import { finishMarkdown, type MarkdownBlock, settledBlock, splitMarkdown } from './stream';
import { escapeAttribute, escapeHtml } from '@runlith/utils/text';

const domPurify = typeof window === 'undefined' ? undefined : createDOMPurify(window);

if (domPurify && createDOMPurify.isSupported) {
  domPurify.setConfig({
    ADD_ATTR: ['tabindex', 'target'],
    FORBID_CONTENTS: ['script', 'style'],
    FORBID_TAGS: ['style'],
    SANITIZE_NAMED_PROPS: true,
    USE_PROFILES: { html: true, mathMl: true },
  });
  domPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (!(node instanceof HTMLAnchorElement) || node.target !== '_blank') return;

    const rel = node.getAttribute('rel') ?? '';
    const values = new Set(rel.split(/\s+/).filter(Boolean));
    values.add('noopener');
    values.add('noreferrer');
    node.setAttribute('rel', Array.from(values).join(' '));
  });
}

export function fallbackMarkdown(value: string): string {
  return escapeHtml(value).replace(/\r\n?/g, '\n').replaceAll('\n', '<br>');
}

export function sanitizeHtml(rawHtml: string, markdown: string): string {
  if (!domPurify || !createDOMPurify.isSupported) return fallbackMarkdown(markdown);

  return domPurify.sanitize(rawHtml);
}

export type MarkdownHtml = { key: string; html: string; live: boolean };

export type MarkdownRender = { text: string; key?: string | undefined; streaming: boolean };

export type MarkdownRendererOptions = { extensions?: MarkedExtension[]; atoms?: readonly RegExp[] };

type Painter = (block: MarkdownBlock, links: Links, live: boolean) => MarkdownHtml;

type Painted = { block: MarkdownBlock; links: number; html: MarkdownHtml };

type Settled = { start: number; end: number; links: number; html: MarkdownHtml };

type Code = { text: string; language: string | undefined };

type Lines = readonly (CodeColours | undefined)[];

type Colouring = { lines: Lines | null; ready: Promise<Lines> };

const BODY_LIMIT = 400;

const codeOf = new WeakMap<MarkdownHtml, readonly Code[]>();

const colourings = new WeakMap<readonly Code[], Colouring>();

let askers = 0;

export function fallbackBlock(text: string): MarkdownHtml {
  return { key: '0', html: fallbackMarkdown(text), live: false };
}

export class MarkdownRenderer {
  private readonly extensions: MarkedExtension[];
  private readonly atoms: readonly RegExp[];
  private parser: Marked | undefined;
  private readonly bodies = new Map<string, Body>();

  constructor(options: MarkdownRendererOptions = {}) {
    this.extensions = options.extensions ?? [];
    this.atoms = options.atoms ?? [];
  }

  render(input: MarkdownRender): MarkdownHtml[] {
    const key = input.key ?? digest(input.text);
    let body: Body | undefined;
    try {
      body = this.body(key, input);
      return body.read(input.text, input.streaming);
    } catch {
      if (body !== undefined && this.bodies.get(key) === body) this.bodies.delete(key);
      return [fallbackBlock(input.text)];
    }
  }

  private body(key: string, input: MarkdownRender): Body {
    const held = this.bodies.get(key);
    const body = held?.continues(input.text, input.streaming)
      ? held
      : new Body(this.markdown().defaults, (block, links, live) => this.paint(block, links, live));
    this.bodies.delete(key);
    this.bodies.set(key, body);
    if (this.bodies.size > BODY_LIMIT) {
      const oldest = this.bodies.keys().next().value;
      if (oldest !== undefined) this.bodies.delete(oldest);
    }
    return body;
  }

  private paint(block: MarkdownBlock, links: Links, live: boolean): MarkdownHtml {
    const parser = this.markdown();
    const lexer = new Lexer(parser.defaults);
    Object.assign(lexer.tokens.links, links);
    const tokens = lexer.lex(block.src);
    const html = { key: String(block.start), html: sanitizeHtml(parser.parser(tokens), block.src), live };
    const code = block.mode === 'open-code' ? [] : codeIn(parser, tokens);
    if (code.some((one) => normalizeCodeLanguage(one.language) !== 'text')) codeOf.set(html, code);
    return html;
  }

  private markdown(): Marked {
    this.parser ??= createMarkdownParser(this.extensions, this.atoms);
    return this.parser;
  }
}

export function codeColours(block: MarkdownHtml): (root: HTMLElement) => (() => void) | undefined {
  return (root) => {
    const code = codeOf.get(block);
    if (code === undefined) return undefined;
    const colouring = colourings.get(code) ?? coloured(code);
    if (colouring.lines !== null) return paintCode(root, code, colouring.lines);
    let active = true;
    let erase: (() => void) | undefined;
    void colouring.ready.then((lines) => {
      if (active) erase = paintCode(root, code, lines);
    });
    return () => {
      active = false;
      erase?.();
    };
  };
}

function coloured(code: readonly Code[]): Colouring {
  const colouring: Colouring = {
    lines: null,
    ready: Promise.all(
      code.map((one) =>
        normalizeCodeLanguage(one.language) === 'text'
          ? undefined
          : highlightLinesOffThread(one.text, one.language, `markdown:${++askers}`),
      ),
    ).then((lines) => (colouring.lines = lines)),
  };
  colourings.set(code, colouring);
  return colouring;
}

function paintCode(root: HTMLElement, code: readonly Code[], lines: Lines): (() => void) | undefined {
  const ink = inkOf(root.ownerDocument);
  const painted: [Inked, StaticRange][] = [];
  let at = 0;
  for (const element of root.querySelectorAll('pre > code')) {
    const one = code[at];
    if (one === undefined) break;
    const shown = visibleCode(one.text, one.language);
    if (element.textContent !== shown) continue;
    const colours = lines[at];
    at += 1;
    if (colours === undefined || colours.size === 0) continue;
    if (ink === null) element.replaceChildren(...colouredLines(element.ownerDocument, shown, colours));
    else highlightLines(ink, element, shown, colours, painted);
  }
  if (painted.length === 0 || ink === null) return undefined;
  return () => {
    for (const [inked, range] of painted) {
      inked.highlight.delete(range);
      if (inked.highlight.size === 0 && !inked.colour.startsWith('var(')) release(ink, inked);
    }
  };
}

type Inked = { colour: string; name: string; highlight: Highlight };

type Ink = {
  view: Window & typeof globalThis;
  sheet: CSSStyleSheet;
  registry: HighlightRegistry;
  colours: Map<string, Inked | null>;
  named: number;
};

const inks = new WeakMap<Document, Ink | null>();

function inkOf(page: Document): Ink | null {
  const held = inks.get(page);
  if (held !== undefined) return held;
  const view = page.defaultView;
  const ink =
    view === null || view.CSS?.highlights === undefined || typeof view.Highlight !== 'function' || typeof view.StaticRange !== 'function'
      ? null
      : { view, sheet: new view.CSSStyleSheet(), registry: view.CSS.highlights, colours: new Map<string, Inked | null>(), named: 0 };
  if (ink !== null) page.adoptedStyleSheets = [...page.adoptedStyleSheets, ink.sheet];
  inks.set(page, ink);
  return ink;
}

function inked(ink: Ink, colour: string): Inked | null {
  const held = ink.colours.get(colour);
  if (held !== undefined) return held;
  let inked: Inked | null = null;
  if (ink.view.CSS.supports('color', colour)) {
    inked = { colour, name: `code-ink-${(ink.named += 1)}`, highlight: new ink.view.Highlight() };
    ink.sheet.insertRule(`::highlight(${inked.name}) { color: ${colour}; }`, ink.sheet.cssRules.length);
    ink.registry.set(inked.name, inked.highlight);
  }
  ink.colours.set(colour, inked);
  return inked;
}

function release(ink: Ink, inked: Inked): void {
  ink.colours.delete(inked.colour);
  ink.registry.delete(inked.name);
  const rules = ink.sheet.cssRules;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    if ((rules[index] as CSSStyleRule).selectorText === `::highlight(${inked.name})`) ink.sheet.deleteRule(index);
  }
}

function highlightLines(ink: Ink, element: Element, shown: string, colours: CodeColours, painted: [Inked, StaticRange][]): void {
  const texts: Text[] = [];
  const starts: number[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let length = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    texts.push(node as Text);
    starts.push(length);
    length += (node as Text).length;
  }
  let text = 0;
  const point = (offset: number): [Text, number] => {
    while (text < texts.length - 1 && starts[text + 1]! <= offset) text += 1;
    return [texts[text]!, offset - starts[text]!];
  };
  let lineStart = 0;
  shown.split('\n').forEach((line, index) => {
    const tokens = colours.get(index);
    if (tokens !== undefined && tokens.map((token) => token.text).join('') === line) {
      let offset = lineStart;
      for (const token of tokens) {
        const held = token.color === undefined || token.text === '' ? null : inked(ink, token.color);
        if (held !== null) {
          const [startContainer, startOffset] = point(offset);
          const [endContainer, endOffset] = point(offset + token.text.length);
          const range = new ink.view.StaticRange({ startContainer, startOffset, endContainer, endOffset });
          held.highlight.add(range);
          painted.push([held, range]);
        }
        offset += token.text.length;
      }
    }
    lineStart += line.length + 1;
  });
}

function colouredLines(page: Document, shown: string, colours: CodeColours): Node[] {
  const nodes: Node[] = [];
  shown.split('\n').forEach((line, at) => {
    if (at > 0) nodes.push(page.createTextNode('\n'));
    const tokens = colours.get(at);
    if (tokens === undefined || tokens.map((token) => token.text).join('') !== line) {
      if (line !== '') nodes.push(page.createTextNode(line));
      return;
    }
    for (const token of tokens) {
      if (token.color === undefined) {
        nodes.push(page.createTextNode(token.text));
        continue;
      }
      const span = page.createElement('span');
      span.setAttribute('style', `color:${token.color}`);
      span.textContent = token.text;
      nodes.push(span);
    }
  });
  return nodes;
}

function codeIn(parser: Marked, tokens: Token[]): Code[] {
  const code: Code[] = [];
  parser.walkTokens(tokens, (token) => {
    if (token.type === 'code') code.push({ text: (token as Tokens.Code).text, language: (token as Tokens.Code).lang });
  });
  return code;
}

class Body {
  #prefix = '';
  #whole: Painted | null = null;
  #finished = false;
  #settled: Settled[] = [];
  #open: Painted[] = [];
  readonly #links: Links = Object.create(null);
  #linkCount = 0;

  constructor(
    private readonly grammar: MarkedOptions,
    private readonly paint: Painter,
  ) {}

  continues(text: string, streaming: boolean): boolean {
    if (this.#whole !== null) return !streaming && this.#whole.block.raw === text;
    if (this.#finished) return !streaming && this.#prefix === text;
    return text.startsWith(this.#prefix);
  }

  read(text: string, streaming: boolean): MarkdownHtml[] {
    if (!streaming && this.#whole === null && this.#settled.length === 0 && this.#open.length === 0) {
      this.#whole = this.#painted({ mode: 'full', start: 0, end: text.length, raw: text, src: text }, false);
    }
    if (this.#whole !== null) return [this.#whole.html];
    if (!this.#finished) this.#grow(text, streaming);
    return [...this.#settled.map((settled) => settled.html), ...this.#open.map((painted) => painted.html)];
  }

  #grow(text: string, streaming: boolean): void {
    const split = (streaming ? splitMarkdown : finishMarkdown)(text, this.#prefix.length, this.grammar);
    if (this.#learn(split.definitions)) this.#settled = this.#settled.map((settled) => this.#relinked(settled));
    for (const block of split.settled) {
      const reused = this.#reused(block);
      const { links, html } = reused ?? this.#painted(block, false);
      this.#settled.push({ start: block.start, end: block.end, links, html: reused ? settledHtml(html) : html });
    }
    this.#open = split.open.map((block) => this.#reused(block) ?? this.#painted(block, true));
    this.#prefix = text.slice(0, split.end);
    this.#finished = !streaming;
    if (this.#finished) this.#joinMarkup(text);
  }

  #joinMarkup(text: string): void {
    const tag = text.indexOf('<');
    const from = tag < 0 ? -1 : this.#settled.findIndex((settled) => settled.end > tag);
    if (from < 0 || from === this.#settled.length - 1) return;
    const block = settledBlock(text, this.#settled[from]!.start, text.length);
    const { links, html } = this.#painted(block, false);
    this.#settled = [...this.#settled.slice(0, from), { start: block.start, end: block.end, links, html }];
  }

  #relinked(settled: Settled): Settled {
    if (settled.links === this.#linkCount) return settled;
    const block = settledBlock(this.#prefix, settled.start, settled.end);
    if (!block.raw.includes('[')) return { ...settled, links: this.#linkCount };
    const { links, html } = this.#painted(block, false);
    return { ...settled, links, html };
  }

  #learn(definitions: readonly Tokens.Def[]): boolean {
    const known = this.#linkCount;
    for (const definition of definitions) {
      if (definition.tag in this.#links) continue;
      this.#links[definition.tag] = { href: definition.href, title: definition.title };
      this.#linkCount += 1;
    }
    return this.#linkCount > known;
  }

  #reused(block: MarkdownBlock): Painted | undefined {
    return this.#open.find(
      (painted) =>
        painted.links === this.#linkCount &&
        painted.block.start === block.start &&
        painted.block.mode === block.mode &&
        painted.block.raw === block.raw,
    );
  }

  #painted(block: MarkdownBlock, live: boolean): Painted {
    return { block, links: this.#linkCount, html: this.paint(block, this.#links, live) };
  }
}

function settledHtml(painted: MarkdownHtml): MarkdownHtml {
  const settled = { ...painted, live: false };
  const code = codeOf.get(painted);
  if (code !== undefined) codeOf.set(settled, code);
  return settled;
}

function digest(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function createMarkdownParser(extensions: MarkedExtension[] = [], atoms: readonly RegExp[] = []): Marked {
  const parser = new Marked({
    breaks: true,
    gfm: true,
  });

  parser.use({
    renderer: {
      code(token: Tokens.Code): string {
        return plainCodeHtml(token.text, token.lang);
      },
      link(token: Tokens.Link): string {
        const href = escapeAttribute(token.href ?? '#');
        const title = token.title ? ` title="${escapeAttribute(token.title)}"` : '';
        const text = this.parser.parseInline(token.tokens);
        return `<a href="${href}"${title} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
    },
  });

  if (atoms.length > 0) parser.use(atomicTable(atoms));
  for (const extension of extensions) parser.use(extension);

  return parser;
}

function atomicTable(atoms: readonly RegExp[]): MarkedExtension {
  const patterns = atoms.map(everyMatch);
  return {
    tokenizer: {
      table(source: string): Tokens.Table | undefined | false {
        const shielded = shieldPipes(source, patterns);
        if (shielded === null) return false;
        const token = Tokenizer.prototype.table.call(this, shielded.text);
        if (!token) return token;
        token.raw = source.slice(0, sourceLength(shielded.escapes, token.raw.length));
        return token;
      },
    },
  };
}

type ShieldedSource = { text: string; escapes: readonly number[] };

function shieldPipes(source: string, patterns: readonly RegExp[]): ShieldedSource | null {
  const blank = source.search(/\n[ \t]*(?:\n|$)/);
  const head = blank < 0 ? source : source.slice(0, blank);
  if (!head.includes('|')) return null;
  const escapes: number[] = [];
  let text = '';
  let read = 0;
  for (const atom of atomSpans(head, patterns)) {
    text += head.slice(read, atom.start);
    for (let at = atom.start; at < atom.end; at += 1) {
      if (head[at] === '|' && backslashes(head, at) % 2 === 0) {
        escapes.push(text.length);
        text += '\\';
      }
      text += head[at];
    }
    read = atom.end;
  }
  if (escapes.length === 0) return null;
  return { text: text + head.slice(read) + source.slice(head.length), escapes };
}

function backslashes(source: string, at: number): number {
  let count = 0;
  while (at - count > 0 && source[at - count - 1] === '\\') count += 1;
  return count;
}

function atomSpans(source: string, patterns: readonly RegExp[]): { start: number; end: number }[] {
  const found = patterns
    .flatMap((pattern) => [...source.matchAll(pattern)])
    .map((match) => ({ start: match.index, end: match.index + match[0].length }))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const kept: { start: number; end: number }[] = [];
  for (const span of found) {
    const previous = kept.at(-1);
    if (previous && span.start < previous.end) continue;
    kept.push(span);
  }
  return kept;
}

function everyMatch(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

function sourceLength(escapes: readonly number[], length: number): number {
  let inserted = 0;
  for (const at of escapes) {
    if (at >= length) break;
    inserted += 1;
  }
  return length - inserted;
}
