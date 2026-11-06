import type { Schema } from 'effect';

declare const madeByPoint: unique symbol;

export type Contribution = { readonly point: string; readonly id: string; readonly [madeByPoint]: true };

export type Contributed<A> = { readonly owner: string; readonly entry: A };

export type PointHeld = {
  readonly plugin: string;
  readonly sibling: <B>(face: PluginFace<B>) => B | undefined;
};

export type PluginFace<W> = {
  readonly name: string;
  readonly title: string;
  readonly schema: Schema.Codec<W, unknown>;
  readonly claims?: (value: W) => readonly string[];
  readonly refuses?: (value: W, held: PointHeld) => string | null;
  readonly calls?: (value: W) => readonly string[];
  readonly serves?: (value: W | undefined, tool: string) => string | null;
};
