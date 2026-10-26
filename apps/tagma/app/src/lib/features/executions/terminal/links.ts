import type { IBufferLine, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import type { Link } from '$lib/features/opening/Link.js';
import { PathChecks } from '$lib/features/opening/PathChecks.js';
import type { PathLink, PathRoad } from '$lib/features/opening/PathLinks.js';
import type { Engine } from './terminalEngine.js';

export const LINK_TIP_EVENT = 'link-tip';

export const URL_MAX_LENGTH = 2048;
export const HOVER_RESET_MS = 150;
export const LINK_DRAG_PX = 4;
const SOFT_WRAP_MAX_ROWS = 200;
const SOFT_WRAP_MAX_CHARS = 20_000;
const HARD_PATH_MAX_ROWS = 20;

export interface FileTarget {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

export type LinkModifier = 'meta' | 'ctrl';

export type LinkPress = 'click' | 'modified';

export type TerminalLink = { readonly kind: 'path'; readonly link: Link } | { readonly kind: 'url'; readonly url: string };

type Paths = PathChecks<PathLink | null>;

export type LinkHint = { readonly keys: string; readonly words: string };

export type LinkTip = { readonly text: string; readonly hints: readonly LinkHint[] };

export type LinkOpener = (link: TerminalLink, press: LinkPress) => void;

export type LinkTeller = (link: TerminalLink, tracking: boolean) => LinkTip;

export type LinkMenu = (link: TerminalLink, at: { readonly x: number; readonly y: number }) => void;

interface LinkRoad {
  readonly tip: HTMLElement;
  readonly open: LinkOpener;
  readonly told: LinkTeller;
  readonly menu: LinkMenu;
  readonly refused: LinkRefused;
  readonly projectRoot: string;
  readonly modifier: LinkModifier;
}

export type LinkRefused = (error: unknown) => void;

export interface LinkCallbacks {
  readonly onLinkClick: (event: MouseEvent, uri: string) => void;
  readonly onLinkHover: (event: MouseEvent, uri: string) => void;
  readonly onLinkLeave: () => void;
}

export function createLinks(
  tip: HTMLElement,
  open: LinkOpener,
  told: LinkTeller,
  menu: LinkMenu,
  road: PathRoad,
  refused: LinkRefused,
  projectRoot: string,
  modifier: LinkModifier,
): { callbacks: LinkCallbacks; install(engine: Engine): () => void } {
  const deps: LinkRoad = { tip, open, told, menu, refused, projectRoot, modifier };
  const gesture = createLinkGesture();
  const cache: Paths = new PathChecks(road);
  const callbacks: LinkCallbacks = {
    onLinkClick: (event, uri) => {
      const press = linkPress(event, deps.modifier, tracking(gesture.terminal));
      if (press === null || !gesture.claim(event, deps.modifier)) return;
      event.preventDefault();
      deps.open({ kind: 'url', url: uri }, press);
      gesture.terminal?.clearSelection();
    },
    onLinkHover: (_event, uri) => showTip(deps.tip, deps.told({ kind: 'url', url: uri }, tracking(gesture.terminal))),
    onLinkLeave: () => {
      deps.tip.style.display = 'none';
    },
  };
  return {
    callbacks,
    install: (engine) => installLinksInto(engine, deps, gesture, cache),
  };
}

export function installLinks(
  engine: Engine,
  tip: HTMLElement,
  open: LinkOpener,
  told: LinkTeller,
  menu: LinkMenu,
  road: PathRoad,
  refused: LinkRefused,
  projectRoot: string,
  modifier: LinkModifier,
): () => void {
  return createLinks(tip, open, told, menu, road, refused, projectRoot, modifier).install(engine);
}

function showTip(tip: HTMLElement, told: LinkTip): void {
  tip.dispatchEvent(new CustomEvent(LINK_TIP_EVENT, { detail: told }));
  tip.style.display = '';
}

function tracking(terminal: Terminal | null): boolean {
  return terminal !== null && terminal.modes.mouseTrackingMode !== 'none';
}

export function isDirectActivation(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'> & Partial<Pick<MouseEvent, 'altKey' | 'button'>>,
  modifier: LinkModifier,
): boolean {
  const held = modifier === 'meta' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return Boolean(held && (event.button === undefined || event.button === 0) && !event.altKey);
}

function linkPress(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'> & Partial<Pick<MouseEvent, 'altKey' | 'button'>>,
  modifier: LinkModifier,
  held: boolean,
): LinkPress | null {
  const direct = isDirectActivation(event, modifier);
  if (held) return direct ? 'click' : null;
  if (direct) return 'modified';
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey && (event.button === undefined || event.button === 0);
  return plain ? 'click' : null;
}

interface GestureState {
  clientX: number;
  clientY: number;
  hadSelection: boolean;
  focusing: boolean;
  moved: boolean;
  claimed: boolean;
}

type Pressed = Pick<MouseEvent, 'metaKey' | 'ctrlKey'> & Partial<Pick<MouseEvent, 'altKey' | 'button'>>;

export interface LinkGesture {
  terminal: Terminal | null;
  canActivate(): boolean;
  claim(event: Pressed, modifier: LinkModifier): boolean;
  dispose(): void;
}

function createLinkGesture(): LinkGesture {
  let pending: GestureState | null = null;
  const gesture: LinkGesture = {
    terminal: null,
    canActivate: () => pending !== null && !pending.moved && !pending.hadSelection && !pending.claimed && !gesture.terminal?.hasSelection(),
    claim: () => {
      if (!gesture.canActivate()) return false;
      if (pending) pending.claimed = true;
      return true;
    },
    dispose: () => {
      pending = null;
    },
  };
  return gesture;
}

function installLinkGesture(
  element: HTMLElement | null,
  gesture: LinkGesture,
  terminal: Terminal,
  isOwned: (event: MouseEvent) => boolean,
): () => void {
  if (!element) return () => undefined;
  gesture.terminal = terminal;
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument?.defaultView ?? null;
  let pending: GestureState | null = null;
  gesture.canActivate = () => pending !== null && !pending.moved && !pending.hadSelection && !pending.claimed && !terminal.hasSelection();
  gesture.claim = (event, modifier) => {
    if (!gesture.canActivate() || (pending?.focusing === true && !isDirectActivation(event, modifier))) return false;
    if (pending) pending.claimed = true;
    return true;
  };

  const clear = (): void => {
    pending = null;
  };
  const onMouseDown = (event: MouseEvent): void => {
    if (!isOwned(event)) {
      clear();
      return;
    }
    const focused = ownerDocument?.activeElement ?? null;
    pending = {
      clientX: event.clientX,
      clientY: event.clientY,
      hadSelection: terminal.hasSelection(),
      focusing: focused === null || !element.contains(focused),
      moved: false,
      claimed: false,
    };
  };
  const onMouseMove = (event: MouseEvent): void => {
    if (pending && Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) > LINK_DRAG_PX) {
      pending.moved = true;
    }
  };
  const onMouseUp = (): void => {
    queueMicrotask(clear);
  };
  element.addEventListener('mousedown', onMouseDown, { capture: true });
  ownerDocument?.addEventListener('mousemove', onMouseMove);
  ownerDocument?.addEventListener('mouseup', onMouseUp);
  ownerWindow?.addEventListener('blur', clear);
  return () => {
    clear();
    gesture.terminal = null;
    element.removeEventListener('mousedown', onMouseDown, { capture: true });
    ownerDocument?.removeEventListener('mousemove', onMouseMove);
    ownerDocument?.removeEventListener('mouseup', onMouseUp);
    ownerWindow?.removeEventListener('blur', clear);
  };
}

export interface ParsedUrl {
  readonly url: string;
  readonly start: number;
  readonly end: number;
}

export function extractUrls(lineText: string): ParsedUrl[] {
  const links: ParsedUrl[] = [];
  let searchStart = 0;
  while (searchStart < lineText.length) {
    const start = nextSchemeIndex(lineText, searchStart);
    if (start === -1) return links;
    if (!isWordBoundary(lineText, start)) {
      searchStart = start + 1;
      continue;
    }
    const rawEnd = urlCandidateEnd(lineText, start);
    const end = trimTrailingPunctuation(lineText, start, rawEnd);
    searchStart = Math.max(rawEnd, start + 1);
    if (end <= start || rawEnd - start > URL_MAX_LENGTH) continue;
    const url = lineText.slice(start, end);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      links.push({ url: parsed.toString(), start, end });
    } catch {}
  }
  return links;
}

function nextSchemeIndex(lineText: string, searchStart: number): number {
  const http = lineText.indexOf('http://', searchStart);
  const https = lineText.indexOf('https://', searchStart);
  const candidates = [http, https].filter((index) => index !== -1);
  return candidates.length === 0 ? -1 : Math.min(...candidates);
}

function isWordBoundary(lineText: string, start: number): boolean {
  return start === 0 || !isAsciiWordCode(lineText.charCodeAt(start - 1));
}

function urlCandidateEnd(lineText: string, start: number): number {
  const scanEnd = Math.min(lineText.length, start + URL_MAX_LENGTH + 1);
  for (let index = start; index < scanEnd; index++) {
    if (isUrlTerminator(lineText.charCodeAt(index))) return index;
  }
  return scanEnd;
}

function trimTrailingPunctuation(lineText: string, start: number, rawEnd: number): number {
  let end = rawEnd;
  while (end > start && isTrailingPunctuation(lineText.charCodeAt(end - 1))) end--;
  return end;
}

const NON_ASCII_URL_TERMINATOR = /[\p{P}\p{S}\p{Z}]/u;

function isUrlTerminator(code: number): boolean {
  return (
    (code > 0x7e && NON_ASCII_URL_TERMINATOR.test(String.fromCharCode(code))) ||
    isAsciiWhitespace(code) ||
    code === 0x22 ||
    code === 0x27 ||
    code === 0x21 ||
    code === 0x2a ||
    code === 0x28 ||
    code === 0x29 ||
    code === 0x7b ||
    code === 0x7d ||
    code === 0x7c ||
    code === 0x5c ||
    code === 0x5e ||
    code === 0x3c ||
    code === 0x3e ||
    code === 0x60
  );
}

function isTrailingPunctuation(code: number): boolean {
  return (
    isAsciiWhitespace(code) ||
    code === 0x22 ||
    code === 0x27 ||
    code === 0x3a ||
    code === 0x2c ||
    code === 0x2e ||
    code === 0x21 ||
    code === 0x3f ||
    code === 0x7b ||
    code === 0x7d ||
    code === 0x7c ||
    code === 0x5c ||
    code === 0x5e ||
    code === 0x7e ||
    code === 0x5b ||
    code === 0x5d ||
    code === 0x28 ||
    code === 0x29 ||
    code === 0x3c ||
    code === 0x3e ||
    code === 0x60
  );
}

function isAsciiWhitespace(code: number): boolean {
  return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}

function isAsciiWordCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || code === 95 || (code >= 97 && code <= 122);
}

export interface ParsedFileRef {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly start: number;
  readonly end: number;
}

const SEPARATOR_PATH_PATTERN =
  /(?:~[\\/]|[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|[A-Za-z0-9._-]+[\\/])[A-Za-z0-9._~\-/%+@\\()[\]]*(?::\d+)?(?::\d+)?/g;
const WORD_TOKEN_PATTERN = /[^\s()[\]{}'",;<>|`]+/g;
const MAX_BARE_TOKEN_LENGTH = 120;
const BARE_FILENAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;

const EXTENSIONLESS_FILENAMES = new Set([
  'Makefile',
  'Dockerfile',
  'Rakefile',
  'Gemfile',
  'Procfile',
  'LICENSE',
  'README',
  'CHANGELOG',
  'AUTHORS',
  'NOTICE',
  'CONTRIBUTING',
]);

export function parseFileRefs(lineText: string): ParsedFileRef[] {
  const refs: ParsedFileRef[] = [];
  const claimed: [number, number][] = [];
  const urls = extractUrls(lineText);
  for (const match of lineText.matchAll(SEPARATOR_PATH_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (urls.some((url) => start >= url.start && end <= url.end)) continue;
    const ref = toFileRef(trimTokenEnd(match[0]), start);
    if (ref && /[\\/]/.test(ref.path)) {
      refs.push(ref);
      claimed.push([start, end]);
    }
  }
  for (const match of lineText.matchAll(WORD_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (match[0].length > MAX_BARE_TOKEN_LENGTH) continue;
    if (claimed.some(([from, to]) => start < to && end > from)) continue;
    if (urls.some((url) => start >= url.start && end <= url.end)) continue;
    const ref = toFileRef(trimTokenEnd(match[0]), start);
    if (ref && looksLikeFilename(ref.path)) {
      refs.push(ref);
    }
  }
  return refs.sort((a, b) => a.start - b.start || b.end - a.end);
}

function trimTokenEnd(token: string): string {
  let end = token.length;
  while (end > 0 && /[.,;!?'")\]]/.test(token[end - 1] ?? '')) end--;
  return token.slice(0, end);
}

function toFileRef(token: string, start: number): ParsedFileRef | null {
  const suffix = /^(.*?):(\d+)(?::(\d+))?$/.exec(token);
  const path = (suffix?.[1] ?? token).replace(/:+$/, '');
  if (path === '') return null;
  return {
    path,
    line: suffix?.[2] === undefined ? null : Number(suffix[2]),
    column: suffix?.[3] === undefined ? null : Number(suffix[3]),
    start,
    end: start + token.length,
  };
}

function looksLikeFilename(path: string): boolean {
  if (path.length < 2 || path.length > 100) return false;
  if (!BARE_FILENAME_PATTERN.test(path)) return false;
  if (/^\d+$/.test(path)) return false;
  if (path.includes('.')) return !/^\.+$/.test(path);
  return EXTENSIONLESS_FILENAMES.has(path);
}

export interface ResolvedFileRef {
  readonly absolute: string;
  readonly line: number | null;
  readonly column: number | null;
}

export function resolveFileRef(ref: ParsedFileRef, projectRoot: string): ResolvedFileRef | null {
  if (ref.path.startsWith('~')) return null;
  const root = projectRoot.replace(/\/+$/, '');
  if (root === '') return null;
  const parts: string[] = [];
  const input = ref.path.startsWith('/') ? ref.path : `${root}/${ref.path}`;
  for (const part of input.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const absolute = `/${parts.join('/')}`;
  if (!ref.path.startsWith('/') && absolute !== root && !absolute.startsWith(`${root}/`)) return null;
  return { absolute, line: ref.line, column: ref.column };
}

export interface LogicalRow {
  readonly y: number;
  readonly text: string;
  readonly columns: number[];
  readonly startIndex: number;
}

export interface LogicalLine {
  readonly text: string;
  readonly rows: LogicalRow[];
  readonly fingerprint: string;
}

type BufferLike = { getLine(y: number): IBufferLine | undefined };
export interface BufferPosition {
  readonly x: number;
  readonly y: number;
}

export function bufferPositionForMouseEvent(terminal: Terminal, event: MouseEvent): BufferPosition | null {
  const screen = terminal.element?.querySelector('.xterm-screen');
  if (!screen || terminal.cols <= 0 || terminal.rows <= 0) return null;
  const rect = screen.getBoundingClientRect();
  const relativeX = event.clientX - rect.left;
  const relativeY = event.clientY - rect.top;
  if (relativeX < 0 || relativeY < 0 || relativeX >= rect.width || relativeY >= rect.height) return null;
  const cellWidth = rect.width / terminal.cols;
  const cellHeight = rect.height / terminal.rows;
  if (cellWidth <= 0 || cellHeight <= 0) return null;
  return {
    x: Math.floor(relativeX / cellWidth) + 1,
    y: Math.floor(relativeY / cellHeight) + terminal.buffer.active.viewportY + 1,
  };
}

function lineTextWithColumns(line: IBufferLine): { text: string; columns: number[] } {
  let text = '';
  const columns: number[] = [];
  let endColumn = 0;
  let complete = true;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) {
      complete = false;
      break;
    }
    const width = cell.getWidth();
    if (width === 0) continue;
    const chars = cell.getChars() || ' ';
    text += chars;
    for (let index = 0; index < chars.length; index++) columns.push(x);
    endColumn = x + Math.max(width, 1);
  }
  if (!complete) {
    const fallback = line.translateToString(true);
    return { text: fallback, columns: fallback.split('').map((_, index) => index) };
  }
  columns.push(endColumn);
  return { text, columns };
}

export function softLogicalLine(buffer: BufferLike, bufferLineNumber: number): LogicalLine | null {
  const y = bufferLineNumber - 1;
  if (!buffer.getLine(y)) return null;
  let startY = y;
  let rowCount = 1;
  while (startY > 0 && buffer.getLine(startY)?.isWrapped) {
    if (rowCount >= SOFT_WRAP_MAX_ROWS) return null;
    startY--;
    rowCount++;
  }
  let endY = y;
  while (buffer.getLine(endY + 1)?.isWrapped) {
    if (rowCount >= SOFT_WRAP_MAX_ROWS) return null;
    endY++;
    rowCount++;
  }
  let text = '';
  const rows: LogicalRow[] = [];
  for (let rowY = startY; rowY <= endY; rowY++) {
    const line = buffer.getLine(rowY);
    if (!line) return null;
    const translated = lineTextWithColumns(line);
    if (text.length + translated.text.length > SOFT_WRAP_MAX_CHARS) return null;
    rows.push({ y: rowY, text: translated.text, columns: translated.columns, startIndex: text.length });
    text += translated.text;
  }
  return { text, rows, fingerprint: rows.map((row) => `${row.y}:${row.text}`).join('\n') };
}

const HARD_PATH_FRAGMENT_PATTERN = /^[A-Za-z0-9._~@%+=:,/\\-]+$/;

function isHardPathFragment(text: string): boolean {
  return HARD_PATH_FRAGMENT_PATTERN.test(text) && /[A-Za-z0-9]/.test(text);
}

function isIncompleteHardPathStart(text: string): boolean {
  return /^(?:[/\\]|\.{1,2}\/|~\/|[A-Za-z]:)$/.test(text);
}

function isHardPathContinuation(text: string): boolean {
  return isHardPathFragment(text) || isIncompleteHardPathStart(text);
}

function canStartHardPath(text: string): boolean {
  if (!isHardPathFragment(text)) {
    return /(?:^|[\s•*>-])(?:\/|\.{1,2}\/|[A-Za-z0-9._-]+\/)[A-Za-z0-9._~@%+=:,/\\-]*$/.test(text);
  }
  return /(?:\/|\\)/.test(text);
}

function trimmedRow(line: IBufferLine | undefined): { text: string; columns: number[] } | null {
  if (!line) return null;
  const translated = lineTextWithColumns(line);
  const start = translated.text.search(/\S/);
  if (start === -1) return null;
  let end = translated.text.length;
  while (end > start && /\s/.test(translated.text[end - 1] ?? '')) end--;
  return { text: translated.text.slice(start, end), columns: translated.columns.slice(start, end + 1) };
}

export function hardPathCandidates(buffer: BufferLike, bufferLineNumber: number): LogicalLine[] {
  const currentY = bufferLineNumber - 1;
  if (!buffer.getLine(currentY)) return [];
  const minY = Math.max(0, currentY - HARD_PATH_MAX_ROWS + 1);
  const candidates: LogicalLine[] = [];
  for (let startY = currentY; startY >= minY; startY--) {
    const start = trimmedRow(buffer.getLine(startY));
    if (!start || !canStartHardPath(start.text)) continue;
    let text = '';
    const rows: LogicalRow[] = [];
    for (let rowY = startY; rowY < startY + HARD_PATH_MAX_ROWS; rowY++) {
      const row = trimmedRow(buffer.getLine(rowY));
      if (!row) break;
      if (rowY > startY && !isHardPathContinuation(row.text)) break;
      rows.push({ y: rowY, text: row.text, columns: row.columns, startIndex: text.length });
      text += row.text;
      if (rowY >= currentY) {
        candidates.push({ text, rows: [...rows], fingerprint: rows.map((row) => `${row.y}:${row.text}`).join('\n') });
      }
    }
  }
  return candidates.sort((a, b) => b.rows.length - a.rows.length);
}

export function candidateLines(buffer: BufferLike, bufferLineNumber: number): LogicalLine[] {
  const lines = hardPathCandidates(buffer, bufferLineNumber);
  const soft = softLogicalLine(buffer, bufferLineNumber);
  if (soft) lines.push(soft);
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.fingerprint)) return false;
    seen.add(line.fingerprint);
    return true;
  });
}

function mapIndexToPosition(line: LogicalLine, index: number, bias: 'start' | 'end'): { x: number; y: number } | null {
  for (let rowIndex = 0; rowIndex < line.rows.length; rowIndex++) {
    const row = line.rows[rowIndex];
    if (!row) continue;
    const rowStart = row.startIndex;
    const rowEnd = rowStart + row.text.length;
    const isTarget =
      bias === 'start'
        ? index < rowEnd || (index === rowEnd && rowIndex === line.rows.length - 1)
        : index <= rowEnd && (index > rowStart || rowIndex === 0);
    if (!isTarget) continue;
    const local = Math.max(0, Math.min(index - rowStart, row.columns.length - 1));
    return { x: row.columns[local] ?? local, y: row.y + 1 };
  }
  return null;
}

export function rangeForMatch(line: LogicalLine, start: number, end: number): IBufferRange | null {
  const from = mapIndexToPosition(line, start, 'start');
  const to = mapIndexToPosition(line, end, 'end');
  if (!from || !to) return null;
  return { start: { x: from.x + 1, y: from.y }, end: { x: to.x, y: to.y } };
}

function rangeContainsPosition(range: IBufferRange, position: BufferPosition, columns: number): boolean {
  const lower = range.start.y * columns + range.start.x;
  const upper = range.end.y * columns + range.end.x;
  const current = position.y * columns + position.x;
  return lower <= current && current <= upper;
}

export type FoundLink = { kind: 'url'; url: string } | { kind: 'path'; target: FileTarget; link: PathLink | undefined };

export function findLinkAt(
  buffer: BufferLike,
  position: BufferPosition,
  columns: number,
  projectRoot: string,
  linkOf: (absolutePath: string) => PathLink | null | undefined,
): FoundLink | null {
  for (const line of candidateLines(buffer, position.y)) {
    for (const parsed of extractUrls(line.text)) {
      const range = rangeForMatch(line, parsed.start, parsed.end);
      if (range && rangeContainsPosition(range, position, columns)) return { kind: 'url', url: parsed.url };
    }
    const matches: { target: FileTarget; cached: PathLink | null | undefined }[] = [];
    for (const ref of parseFileRefs(line.text)) {
      const resolved = resolveFileRef(ref, projectRoot);
      if (!resolved) continue;
      const range = rangeForMatch(line, ref.start, ref.end);
      if (!range || !rangeContainsPosition(range, position, columns)) continue;
      matches.push({
        target: { path: resolved.absolute, line: resolved.line, column: resolved.column },
        cached: linkOf(resolved.absolute),
      });
    }
    const probed = matches.filter((match) => match.cached != null).sort((a, b) => b.target.path.length - a.target.path.length)[0];
    const unprobed = matches.find((match) => match.cached !== null);
    const winner = probed ?? unprobed;
    if (winner) return { kind: 'path', target: winner.target, link: winner.cached ?? undefined };
  }
  return null;
}

interface LinkifierHoverCache {
  _lastBufferCell?: unknown;
  _activeLine?: number;
  _clearCurrentLink?: () => void;
  _currentLink?: unknown;
}

function linkifierOf(terminal: Terminal): LinkifierHoverCache | undefined {
  try {
    const core = (
      terminal as unknown as {
        _core?: { linkifier?: LinkifierHoverCache; _linkifier?: { value?: LinkifierHoverCache } | LinkifierHoverCache };
      }
    )._core;
    if (!core || typeof core !== 'object') return undefined;
    const holder = core._linkifier;
    if (holder !== null && typeof holder === 'object') {
      if ('value' in holder) return (holder as { value?: LinkifierHoverCache }).value ?? core.linkifier;
      if ('_handleMouseMove' in holder) return holder as LinkifierHoverCache;
    }
    return core.linkifier;
  } catch {
    return undefined;
  }
}

export function resetHoverCache(terminal: Terminal): void {
  try {
    const linkifier = linkifierOf(terminal);
    try {
      if (typeof linkifier?._clearCurrentLink === 'function') linkifier._clearCurrentLink();
    } catch {}
    if (linkifier && typeof linkifier === 'object') {
      if ('_currentLink' in linkifier) linkifier._currentLink = undefined;
      if ('_lastBufferCell' in linkifier) linkifier._lastBufferCell = undefined;
      if ('_activeLine' in linkifier) linkifier._activeLine = -1;
    }
    terminal.element?.querySelector('.xterm-screen')?.classList.remove('xterm-cursor-pointer');
  } catch {}
}

export function isHoverActive(terminal: Terminal): boolean {
  try {
    const linkifier = linkifierOf(terminal);
    return Boolean(linkifier && '_currentLink' in linkifier && linkifier._currentLink);
  } catch {
    return false;
  }
}

export type HoverSchedule = (run: () => void, ms: number) => () => void;

const timeoutSchedule: HoverSchedule = (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

export function installHoverReset(terminal: Terminal, tip: HTMLElement, schedule: HoverSchedule = timeoutSchedule): () => void {
  const releases: (() => void)[] = [];
  if (typeof terminal.onWriteParsed === 'function') {
    let cancel: (() => void) | null = null;
    const flush = (): void => {
      if (isHoverActive(terminal)) {
        cancel = schedule(flush, HOVER_RESET_MS);
        return;
      }
      cancel = null;
      resetHoverCache(terminal);
    };
    const writeParsed = terminal.onWriteParsed(() => {
      if (cancel === null) cancel = schedule(flush, HOVER_RESET_MS);
    });
    releases.push(() => {
      if (cancel !== null) {
        cancel();
        cancel = null;
      }
      writeParsed.dispose();
    });
  }
  const hide = (): void => {
    tip.style.display = 'none';
    resetHoverCache(terminal);
  };
  const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null;
  if (screen) {
    screen.addEventListener('mouseleave', hide);
    releases.push(() => screen.removeEventListener('mouseleave', hide));
  }
  const ownerWindow = tip.ownerDocument?.defaultView ?? null;
  if (ownerWindow) {
    ownerWindow.addEventListener('blur', hide);
    releases.push(() => ownerWindow.removeEventListener('blur', hide));
  }
  return () => {
    for (const release of releases.reverse()) {
      try {
        release();
      } catch {}
    }
  };
}

interface PrimableLinkifier {
  _activeLine?: number;
  _currentLink?: unknown;
  _handleMouseMove?: (event: MouseEvent) => void;
  _lastBufferCell?: unknown;
}

export function installClickPriming(terminal: Terminal, isOwned: (event: MouseEvent) => boolean): () => void {
  const element = terminal.element;
  if (!element) return () => undefined;
  const onMouseDown = (event: MouseEvent): void => {
    if (!isOwned(event)) return;
    try {
      const linkifier = linkifierOf(terminal) as PrimableLinkifier | undefined;
      if (!linkifier || typeof linkifier._handleMouseMove !== 'function') return;
      if (!linkifier._currentLink) {
        if ('_lastBufferCell' in linkifier) linkifier._lastBufferCell = undefined;
        if ('_activeLine' in linkifier) linkifier._activeLine = -1;
      }
      linkifier._handleMouseMove(event);
    } catch {}
  };
  element.addEventListener('mousedown', onMouseDown, { capture: true });
  return () => element.removeEventListener('mousedown', onMouseDown, { capture: true });
}

function createFileProvider(terminal: Terminal, deps: LinkRoad, cache: Paths, gesture: LinkGesture): ILinkProvider {
  return {
    provideLinks: (bufferLineNumber, callback) => {
      const buffer = terminal.buffer.active;
      const lines = candidateLines(buffer, bufferLineNumber);
      if (lines.every((line) => !line.text)) {
        callback(undefined);
        return;
      }
      const candidates = lines.flatMap((line) => parseFileRefs(line.text).map((ref) => ({ line, ref })));
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }
      void (async () => {
        const provided: { line: LogicalLine; link: ILink }[] = [];
        for (const { line, ref } of candidates) {
          const resolved = resolveFileRef(ref, deps.projectRoot);
          if (!resolved) continue;
          const range = rangeForMatch(line, ref.start, ref.end);
          if (!range) continue;
          let made = cache.known(resolved.absolute);
          if (made === undefined) {
            const probed = await cache.read(resolved.absolute).catch(() => undefined);
            if (probed === undefined) continue;
            made = probed;
          }
          if (made === null) continue;
          const link: TerminalLink = {
            kind: 'path',
            link: made({ path: resolved.absolute, line: resolved.line, column: resolved.column }),
          };
          provided.push({
            line,
            link: {
              range,
              text: line.text.slice(ref.start, ref.end),
              activate: (event) => {
                const press = linkPress(event, deps.modifier, tracking(terminal));
                if (press === null || !gesture.claim(event, deps.modifier)) return;
                event.preventDefault();
                deps.open(link, press);
                terminal.clearSelection?.();
              },
              hover: () => {
                showTip(deps.tip, deps.told(link, tracking(terminal)));
              },
              leave: () => {
                deps.tip.style.display = 'none';
              },
            },
          });
        }
        const fresh = new Set(candidateLines(buffer, bufferLineNumber).map((line) => line.fingerprint));
        const links = provided.filter(({ line }) => fresh.has(line.fingerprint)).map(({ link }) => link);
        if (provided.length > 0 && links.length === 0) return;
        callback(links.length > 0 ? links : undefined);
      })();
    },
  };
}

type Routed = { readonly kind: 'url'; readonly url: string } | { readonly kind: 'path'; readonly target: FileTarget };

function routeOscLink(text: string, deps: LinkRoad): Routed | null {
  let parsed: URL | null = null;
  try {
    parsed = new URL(text);
  } catch {
    parsed = null;
  }
  if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return { kind: 'url', url: parsed.toString() };
  if (parsed && parsed.protocol === 'file:') {
    if (parsed.host !== '') return null;
    const filePath = decodeURIComponent(parsed.pathname);
    const ref = toFileRef(trimTokenEnd(filePath), 0);
    if (!ref || ref.path === '') return null;
    return { kind: 'path', target: { path: ref.path, line: ref.line, column: ref.column } };
  }
  if (parsed) return null;
  const refs = parseFileRefs(text);
  const exact = refs.find((ref) => ref.start === 0 && ref.end === text.length);
  if (!exact) return null;
  const resolved = resolveFileRef(exact, deps.projectRoot);
  if (!resolved) return null;
  return { kind: 'path', target: { path: resolved.absolute, line: resolved.line, column: resolved.column } };
}

function openPath(deps: LinkRoad, cache: Paths, target: FileTarget, press: LinkPress, made: PathLink | null | undefined): void {
  if (made !== undefined) {
    if (made !== null) deps.open({ kind: 'path', link: made(target) }, press);
    return;
  }
  void cache.read(target.path).then((read) => {
    if (read !== null) deps.open({ kind: 'path', link: read(target) }, press);
  }, deps.refused);
}

function installOscLinks(terminal: Terminal, deps: LinkRoad, cache: Paths, gesture: LinkGesture): () => void {
  const previous = terminal.options.linkHandler;
  let hovered: string | null = null;
  const tipOf = (text: string, routed: Routed | null): LinkTip => {
    if (routed?.kind === 'url') return deps.told(routed, tracking(terminal));
    const made = routed === null ? null : cache.known(routed.target.path);
    return made == null || routed === null
      ? { text, hints: [] }
      : deps.told({ kind: 'path', link: made(routed.target) }, tracking(terminal));
  };
  terminal.options.linkHandler = {
    allowNonHttpProtocols: true,
    activate: (event, text) => {
      const routed = routeOscLink(text, deps);
      if (!routed) return;
      const press = linkPress(event, deps.modifier, tracking(terminal));
      if (press === null || !gesture.claim(event, deps.modifier)) return;
      event.preventDefault();
      if (routed.kind === 'url') deps.open(routed, press);
      else openPath(deps, cache, routed.target, press, cache.known(routed.target.path));
      terminal.clearSelection?.();
    },
    hover: (_event, text) => {
      hovered = text;
      const routed = routeOscLink(text, deps);
      if (routed?.kind === 'path' && cache.known(routed.target.path) === undefined) {
        void cache.read(routed.target.path).then(
          () => {
            if (hovered === text) showTip(deps.tip, tipOf(text, routed));
          },
          () => undefined,
        );
      }
      showTip(deps.tip, tipOf(text, routed));
    },
    leave: () => {
      hovered = null;
      deps.tip.style.display = 'none';
    },
  };
  return () => {
    try {
      if (terminal.options.linkHandler !== previous) terminal.options.linkHandler = previous ?? null;
    } catch {}
  };
}

function installClickFallback(terminal: Terminal, deps: LinkRoad, cache: Paths, gesture: LinkGesture): () => void {
  const element = terminal.element;
  if (!element) return () => undefined;
  const onMouseUp = (event: MouseEvent): void => {
    const press = linkPress(event, deps.modifier, tracking(terminal));
    if (event.defaultPrevented || press === null) return;
    const position = bufferPositionForMouseEvent(terminal, event);
    if (!position) return;
    const found = findLinkAt(terminal.buffer.active, position, terminal.cols, deps.projectRoot, (absolute) => cache.known(absolute));
    if (!found || !gesture.claim(event, deps.modifier)) return;
    event.preventDefault();
    event.stopPropagation();
    if (found.kind === 'url') deps.open({ kind: 'url', url: found.url }, press);
    else openPath(deps, cache, found.target, press, found.link);
    terminal.clearSelection();
  };
  element.addEventListener('mouseup', onMouseUp);
  return () => element.removeEventListener('mouseup', onMouseUp);
}

function linkUnder(terminal: Terminal, deps: LinkRoad, cache: Paths, event: MouseEvent): TerminalLink | null {
  const position = bufferPositionForMouseEvent(terminal, event);
  if (!position) return null;
  const found = findLinkAt(terminal.buffer.active, position, terminal.cols, deps.projectRoot, (absolute) => cache.known(absolute));
  if (!found) return null;
  if (found.kind === 'url') return { kind: 'url', url: found.url };
  return found.link === undefined ? null : { kind: 'path', link: found.link(found.target) };
}

function installHeldClaim(terminal: Terminal, deps: LinkRoad, cache: Paths): () => void {
  const element = terminal.element;
  if (!element) return () => undefined;
  const onMouseDown = (event: MouseEvent): void => {
    if (tracking(terminal) && isDirectActivation(event, deps.modifier) && linkUnder(terminal, deps, cache, event) !== null) {
      event.stopPropagation();
    }
  };
  element.addEventListener('mousedown', onMouseDown, { capture: true });
  return () => element.removeEventListener('mousedown', onMouseDown, { capture: true });
}

function installLinkMenu(terminal: Terminal, deps: LinkRoad, cache: Paths): () => void {
  const element = terminal.element;
  if (!element) return () => undefined;
  const onContextMenu = (event: MouseEvent): void => {
    const link = linkUnder(terminal, deps, cache, event);
    if (link === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    deps.menu(link, { x: event.clientX, y: event.clientY });
  };
  element.addEventListener('contextmenu', onContextMenu, { capture: true });
  return () => element.removeEventListener('contextmenu', onContextMenu, { capture: true });
}

function installLinksInto(engine: Engine, deps: LinkRoad, gesture: LinkGesture, cache: Paths): () => void {
  const terminal = engine.terminal;
  const isOwned = (event: MouseEvent): boolean => linkPress(event, deps.modifier, tracking(terminal)) !== null;
  const releases: (() => void)[] = [
    installLinkGesture(terminal.element ?? null, gesture, terminal, isOwned),
    installHeldClaim(terminal, deps, cache),
    installHoverReset(terminal, deps.tip),
    installClickPriming(terminal, isOwned),
    installClickFallback(terminal, deps, cache, gesture),
    installLinkMenu(terminal, deps, cache),
    installOscLinks(terminal, deps, cache, gesture),
  ];
  const fileLinks = terminal.registerLinkProvider(createFileProvider(terminal, deps, cache, gesture));
  releases.push(() => fileLinks.dispose());
  const release = (): void => {
    for (const step of releases.reverse()) {
      try {
        step();
      } catch {}
    }
  };
  engine.onDispose(release);
  return release;
}
