import type { Component } from 'svelte';

export interface Shown<Props extends Record<string, unknown>, View = never> {
  readonly payload: { readonly component: Component<Props> } | { readonly view: View };
}

export type ViewOf<Item> = Item extends { readonly payload: infer P } ? (P extends { readonly view: infer V } ? V : never) : never;
