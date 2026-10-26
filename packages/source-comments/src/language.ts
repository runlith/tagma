export type CommentRange = {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly text: string;
};

export type Unlexable = { readonly unlexable: string };

export type CommentMarker = {
  readonly line?: string;
  readonly block?: { readonly open: string; readonly close: string };
};

export type Directive = {
  readonly opens: string;
  readonly side: 'content' | 'raw';
};

export type Language = {
  readonly name: string;
  readonly extensions: readonly string[];
  comments(text: string): readonly CommentRange[] | Unlexable;
  readonly directives: readonly Directive[];
  readonly marker: CommentMarker;
  readonly continuation?: string;
};
