import type { Component, Snippet } from 'svelte';

export type MenuIcon = Component<{ class?: string }>;

export type Lead = { readonly icon: MenuIcon; readonly lead?: undefined } | { readonly lead: Snippet; readonly icon?: undefined };

export type BareLead = Lead | { readonly icon?: undefined; readonly lead?: undefined };

type Tails = {
  readonly keys: string | null;
  readonly current: string | null;
  readonly hint: string;
  readonly here: boolean;
  readonly tail: Snippet;
};

type Only<K extends keyof Tails> = { readonly [P in K]?: Tails[P] | undefined } & {
  readonly [P in Exclude<keyof Tails, K>]?: undefined;
};

export type Tail = Only<'keys'> | Only<'current'> | Only<'hint'> | Only<'here'> | Only<'tail'>;

export type Unstyled = { readonly unstyled: true; readonly icon?: undefined; readonly lead?: undefined } & Only<never>;

export const ROW =
  'group/menu-row relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-ui outline-hidden select-none data-highlighted:bg-selected data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50';
