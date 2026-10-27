import type { Seen } from '@runlith/code-editor/marks';
import type { AuthorshipSide } from '@tagma/server/change-record/contract/wire/authorship';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';

export type TabKind = 'file' | 'image' | 'preview' | 'diff' | 'compare';

export type TabState = 'preview' | 'open' | 'pinned';

export type DiffAim = { readonly commit: string | null; readonly side: AuthorshipSide | null };

export type TabGoto = { readonly line: number; readonly column: number; readonly length?: number };

export type Tab = {
  readonly id: string;
  readonly rootId: RootId | null;
  readonly branch: string | null;
  readonly path: string;
  readonly kind: TabKind;
  readonly diff: DiffAim | null;
  readonly state: TabState;
  readonly view: Seen | null;
  readonly goto: TabGoto | null;
};

export type CheckoutTab = Tab & { readonly rootId: RootId };

export const inCheckout = (tab: Tab): tab is CheckoutTab => tab.rootId !== null;

export type TabTarget = {
  readonly rootId: RootId | null;
  readonly branch?: string | null;
  readonly path: string;
  readonly kind: TabKind;
  readonly diff?: DiffAim | null;
  readonly goto?: TabGoto | null;
};

export type TabsDocument = {
  readonly tabs: readonly Tab[];
  readonly active: string | null;
  readonly recent: readonly string[];
};

export const IMAGE_TYPES = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;

export const MARKDOWN_TYPES = /\.(md|markdown|mdx)$/i;

export const SVG_TYPES = /\.svgz?$/i;

export const isSvg = (path: string): boolean => SVG_TYPES.test(path);

export const isPreviewable = (path: string): boolean => MARKDOWN_TYPES.test(path) || SVG_TYPES.test(path);

export const isImage = (path: string): boolean => IMAGE_TYPES.test(path);

export const kindFor = (path: string, atLine = false): TabKind => (isImage(path) ? 'image' : isSvg(path) && !atLine ? 'preview' : 'file');

export const tabId = (target: { readonly rootId: RootId | null; readonly path: string; readonly kind: TabKind }): string =>
  `${target.kind}\u0000${target.rootId ?? ''}\u0000${target.path}`;

const KINDS: readonly string[] = ['file', 'image', 'preview', 'diff'];
const STATES: readonly string[] = ['preview', 'open', 'pinned'];
const SIDES: readonly string[] = ['staged', 'unstaged'];

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

function diffOf(value: unknown): DiffAim | null {
  if (!record(value)) return null;
  const commit = typeof value['commit'] === 'string' ? value['commit'] : null;
  const side = typeof value['side'] === 'string' && SIDES.includes(value['side']) ? (value['side'] as AuthorshipSide) : null;
  return { commit, side };
}

function viewOf(value: unknown): Seen | null {
  if (!record(value)) return null;
  const line = count(value['line']);
  const column = count(value['column']);
  const scroll = count(value['scroll']);
  if (line === null || column === null || scroll === null) return null;
  const anchor = value['anchor'];
  const startLine = record(anchor) ? count(anchor['line']) : null;
  const startColumn = record(anchor) ? count(anchor['column']) : null;
  return {
    line,
    column,
    scroll,
    anchor: startLine === null || startColumn === null ? undefined : { line: startLine, column: startColumn },
  };
}

function tabOf(value: unknown): Tab | null {
  if (!record(value)) return null;
  const { rootId, path, kind, state } = value;
  if (!(rootId === null || (typeof rootId === 'string' && rootId !== '')) || typeof path !== 'string' || path === '') return null;
  if (typeof kind !== 'string' || !KINDS.includes(kind) || typeof state !== 'string' || !STATES.includes(state)) return null;
  const made = { rootId: rootId as RootId | null, path, kind: kind as TabKind };
  return {
    ...made,
    id: tabId(made),
    branch: typeof value['branch'] === 'string' ? value['branch'] : null,
    diff: kind === 'diff' ? (diffOf(value['diff']) ?? { commit: null, side: null }) : null,
    state: state as TabState,
    view: viewOf(value['view']),
    goto: null,
  };
}

export function documentOf(stored: string | null): TabsDocument {
  const empty: TabsDocument = { tabs: [], active: null, recent: [] };
  if (stored === null) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return empty;
  }
  if (!record(parsed)) return empty;
  const seen = new Set<string>();
  const tabs: Tab[] = [];
  for (const one of Array.isArray(parsed['tabs']) ? parsed['tabs'] : []) {
    const tab = tabOf(one);
    if (tab === null || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
  }
  const active = typeof parsed['active'] === 'string' && seen.has(parsed['active']) ? parsed['active'] : (tabs[0]?.id ?? null);
  const recent = Array.isArray(parsed['recent']) ? parsed['recent'].filter((path): path is string => typeof path === 'string') : [];
  return { tabs, active, recent };
}

export function documentJson(document: TabsDocument): string {
  return JSON.stringify({
    tabs: document.tabs.filter((tab) => tab.kind !== 'compare').map(({ goto: _goto, ...kept }) => kept),
    active: document.active,
    recent: document.recent,
  });
}

export const RECENT_KEPT = 200;

export const CLOSED_KEPT = 20;
