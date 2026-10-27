export type LineRange = { readonly from: number; readonly to: number };

export type Point = { readonly line: number; readonly column: number };

export type Position = {
  readonly line: number;
  readonly column?: number;
  readonly length?: number;
  readonly scroll?: number;
  readonly anchor?: Point;
};

export type Seen = Point & { readonly scroll: number; readonly anchor?: Point };

export type Mark = { readonly id: string; readonly label: string; readonly colour: string };

export type StripKind = 'added' | 'changed' | 'removed';

export type Strip = LineRange & { readonly kind: StripKind; readonly mark: Mark | null };

export type LineMarker = { readonly line: number; readonly label: string; readonly colour: string };

export type DiffKind = 'context' | 'added' | 'removed';

export type DiffSpan = { readonly start: number; readonly end: number };

export type DiffLine = {
  readonly kind: DiffKind;
  readonly text: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly mark: Mark | null;
  readonly spans: readonly DiffSpan[];
  readonly hiddenBefore: number;
  readonly hiddenAt: number;
};

export type Expand = (at: number, lines: number) => void | Promise<void>;

export type PressMark = (mark: Mark) => void;

export type Colouring = { readonly kind: 'coloured' | 'plain' } | { readonly kind: 'failed'; readonly message: string };

export type FindQuery = {
  readonly search: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regexp: boolean;
  readonly replace: string;
};

export type FindMatches = { readonly total: number; readonly current: number | null; readonly more: boolean };

export type FindField = 'search' | 'replace';

export type FindFocus = { readonly field: FindField };

export type Find = {
  readonly query: FindQuery;
  readonly matches: FindMatches | null;
  readonly invalid: boolean;
  readonly replaceable: boolean;
  readonly focus: FindFocus;
  set(patch: Partial<FindQuery>): void;
  next(): void;
  previous(): void;
  selectAll(): void;
  replace(): void;
  replaceAll(): void;
  close(): void;
};
